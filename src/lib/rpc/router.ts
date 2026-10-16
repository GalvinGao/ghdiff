import { implement, type MiddlewareNextFn, ORPCError } from '@orpc/server';

import { contract } from './contract';
import {
  authExpiredMessage,
  failureForStatus,
  type FailureMeta,
} from '@/lib/failure';
import {
  forgeGroupKey,
  formatRepoRef,
  type ForgeName,
  type PullRef,
  type RepoRef,
  repoRefFromTarget,
} from '@/lib/forges';
import { installUrl as buildInstallUrl } from '@/lib/github/app';
import type { RequestLog } from '@/lib/logger';
import type { OpenPullsAnswer } from '@/lib/pulls';
import type { ForgeTarget } from '@/lib/reviewTarget';
import type { DeploymentConfig } from '@/lib/server/config';
import type { ResolvedCredentials } from '@/lib/server/credentials';
import { forgeFor, forgeNamed } from '@/lib/server/forges';
import type { Forge, ForgeCredential } from '@/lib/server/forges/types';
import { GitHubError } from '@/lib/server/github/client';
import { readInstallations } from '@/lib/server/github/installations';
import { readServedCount } from '@/lib/server/served';
import { m } from '@/paraglide/messages.js';

// The Worker's half of the contract. Nothing here is imported by the browser:
// the client is built from `contract`, which holds no implementation, so this
// module and the forge implementations under it stay out of the client bundle
// however the hooks are written.

/**
 * What the route hands every procedure, read once at the edge: the deployment
 * config, the request's wide event, and the request's resolved credentials.
 * What a procedure can derive per input — the forge, the credential it speaks
 * with — is injected per procedure by the middleware below, not carried here.
 */
export interface RpcContext {
  /** What this deployment serves, parsed from the environment at the route. */
  config: DeploymentConfig;
  /** The request's wide event, started by the route's middleware. */
  log: RequestLog;
  /** Every credential the request speaks with, resolved once at the edge. */
  credentials: ResolvedCredentials;
}

// The gate stands over every procedure. A cookie that is due a refresh is
// answered 401 before any procedure runs, because a 401 is the only answer the
// client refreshes on: `withRefresh` asks `/api/auth/refresh` and sends the
// call again with the mended cookie. It is an `ORPCError` and not a bare
// response from the route, so that the one time a reviewer reads it — a
// refresh that failed — the client decodes a sentence rather than a body it
// cannot parse. The typed `auth-expired` rides the error's data; which grant
// died is not knowable at this edge — GitHub's and GitLab's dues share one
// reading — so the failure names no forge and the sentence names none either.
const os = implement(contract)
  .$context<RpcContext>()
  .use(({ context, next }) => {
    if (context.credentials.refreshDue) {
      context.log.set({ outcome: 'refresh-due' });
      throw new ORPCError('UNAUTHORIZED', {
        status: 401,
        message: authExpiredMessage(),
        data: { failure: { reason: 'auth-expired' } satisfies FailureMeta },
      });
    }
    return next();
  });

const MAX_WATCHED_REPOS = 25;

/**
 * What `fail` needs to type a forge failure: the ref the call named, and
 * whether a credential spoke. The 401 reading turns on the second — a spent
 * or revoked grant is `auth-expired`, an anonymous refusal `auth-required` —
 * and the forge and host travel so the client never parses them out of the
 * sentence.
 */
interface FailureSource {
  ref?: { forge: ForgeName; host?: string };
  credentialed?: boolean;
}

/**
 * Turns a failure from a forge into one the client can read. The status is what
 * survives the trip, so `rateLimitedStatus`'s work upstream still reaches the
 * browser: a quota that is gone is 429 here as it is everywhere else. A gate's
 * own `ORPCError` — a missing token, a capability the forge does not have —
 * passes through as it is. A `GitHubError` that already carries its `failure`
 * — the forge gate's `not-served` — keeps it; one that carries only a status
 * is mapped through `failureForStatus`.
 */
function fail(
  error: unknown,
  fallback: string,
  source: FailureSource = {}
): never {
  if (error instanceof ORPCError) throw error;
  if (error instanceof GitHubError) {
    // GraphQL reports an error inside a 200, and oRPC refuses an error status
    // under 400 by masking it as a bare 500. It is the forge's own answer, so
    // it travels as the gateway's failure, its sentence intact.
    const status = error.status >= 400 ? error.status : 502;
    const failure =
      error.failure ??
      failureForStatus(status, {
        forge: source.ref?.forge,
        host: source.ref?.host,
        credentialed: source.credentialed === true,
      });
    throw new ORPCError(codeForStatus(status), {
      status,
      message: error.message,
      ...(failure != null ? { data: { failure } } : {}),
      cause: error,
    });
  }
  throw new ORPCError('INTERNAL_SERVER_ERROR', {
    message: error instanceof Error ? error.message : fallback,
    cause: error,
  });
}

function codeForStatus(status: number): string {
  switch (status) {
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 429:
      return 'TOO_MANY_REQUESTS';
    default:
      // A 5xx is the forge's gateway failing, not this app's internals — and
      // oRPC masks INTERNAL_SERVER_ERROR's message on the wire, which is how
      // a reviewer once got a bare "500 Internal Server Error" for a failure
      // the forge had explained. BAD_GATEWAY keeps the meaning and lets the
      // sentence through.
      return status >= 500 ? 'BAD_GATEWAY' : 'BAD_REQUEST';
  }
}

/** The credential a forge sees for one ref, per the ref's own forge group. */
function credFor(
  credentials: ResolvedCredentials,
  ref: RepoRef
): ForgeCredential {
  // A credential named on the request itself wins, the way it wins for the
  // plain routes: a caller that named one meant that one. (GitHub's slot
  // already holds it — `resolveGitHubToken`'s cascade puts the header first.)
  if (ref.forge === 'gitlab' && credentials.headerToken != null) {
    return { token: credentials.headerToken, scheme: 'bearer' };
  }
  return credentials.byForge[forgeGroupKey(ref)] ?? {};
}

/**
 * A seam a forge may not have — drafts, thread resolve, viewed-file marks —
 * or a BAD_REQUEST with the sentence that says what it keeps none of.
 */
function requireCapability<T>(capability: T | undefined, message: string): T {
  if (capability == null) {
    throw new ORPCError('BAD_REQUEST', { status: 400, message });
  }
  return capability;
}

/**
 * The forge for one ref, with the gate's 404 mapped through `fail` the way a
 * handler maps it — raised in a middleware, a bare GitHubError would read as
 * a masked 500.
 */
function forgeForRef(config: DeploymentConfig, ref: RepoRef): Forge {
  try {
    return forgeFor(config, ref);
  } catch (error) {
    return fail(error, m.router_could_not_load_this_repository(), { ref });
  }
}

/** The options a ref middleware reads: the request context and the next call. */
type RefMiddlewareOptions<TOutput> = {
  context: RpcContext;
  next: MiddlewareNextFn<TOutput>;
};

// The forge the input's ref is on, the credential it speaks with, and the
// log's ref/pull fields — set once here, not in twelve handlers.
const withForge = <TOutput>(
  { context, next }: RefMiddlewareOptions<TOutput>,
  input: PullRef
) => {
  context.log.set({ ref: formatRepoRef(input), pull: input.number });
  return next({
    context: {
      forge: forgeForRef(context.config, input),
      cred: credFor(context.credentials, input),
    },
  });
};

/** The writes a credential is asked for, each with the sentence per forge. */
const AUTH_REQUIRED = {
  review: {
    github: m.auth_required_review,
    gitlab: m.auth_required_gitlab_review,
  },
  comment: {
    github: m.auth_required_comment,
    gitlab: m.auth_required_gitlab_comment,
  },
  delete: {
    github: m.auth_required_delete,
    gitlab: m.auth_required_gitlab_delete,
  },
  resolve: {
    github: m.auth_required_resolve,
    gitlab: m.auth_required_gitlab_resolve,
  },
  stage: {
    github: m.auth_required_stage,
    gitlab: m.auth_required_gitlab_stage,
  },
  unstage: {
    github: m.auth_required_unstage,
    gitlab: m.auth_required_gitlab_unstage,
  },
  viewed: {
    github: m.auth_required_viewed,
    gitlab: m.auth_required_gitlab_viewed,
  },
  issue: {
    github: m.auth_required_issue,
    gitlab: m.auth_required_gitlab_issue,
  },
} satisfies Record<string, Record<ForgeName, () => string>>;

type AuthAction = keyof typeof AUTH_REQUIRED;

/**
 * The 401 a write without a credential gets, naming the action. The failure is
 * typed `auth-required` with the ref's forge and host beside the sentence, so
 * the client reads the reason without parsing the wording.
 */
function authRequired(
  action: AuthAction,
  ref: RepoRef
): ORPCError<string, unknown> {
  return new ORPCError('UNAUTHORIZED', {
    status: 401,
    message: AUTH_REQUIRED[action][ref.forge](),
    data: {
      failure: {
        reason: 'auth-required',
        forge: ref.forge,
        ...(ref.forge === 'gitlab' ? { host: ref.host } : {}),
      } satisfies FailureMeta,
    },
  });
}

// The same, but a missing token is the 401 that names the action — answered
// here before the handler runs, so the handler never sees a tokenless write.
const withAuth =
  (action: AuthAction) =>
  <TOutput>(
    { context, next }: RefMiddlewareOptions<TOutput>,
    input: PullRef
  ) => {
    context.log.set({ ref: formatRepoRef(input), pull: input.number });
    const forge = forgeForRef(context.config, input);
    const cred = credFor(context.credentials, input);
    if (cred.token == null) throw authRequired(action, input);
    return next({ context: { forge, cred } });
  };

// The forge and credential for an input that names a whole review target
// rather than a pull request — a commit and a compare range have deployments
// and lines to file an issue from too.
const withTargetForge = <TOutput>(
  { context, next }: RefMiddlewareOptions<TOutput>,
  input: { target: ForgeTarget }
) => {
  const ref = repoRefFromTarget(input.target);
  context.log.set({ ref: formatRepoRef(ref), targetKind: input.target.kind });
  return next({
    context: {
      ref,
      forge: forgeForRef(context.config, ref),
      cred: credFor(context.credentials, ref),
    },
  });
};

const getViewer = os.viewer.get.handler(
  async ({ context: { config, log, credentials } }) => {
    // A sign-out is offered when any credential came out of the sealed cookie —
    // the GitHub grant's, or any GitLab connection's. A viewer resolved from
    // `GITHUB_TOKEN` or a named header has no session to end.
    const fromSession = Object.values(credentials.byForge).some(
      (grant) => grant.fromSession === true
    );
    // Disconnect GitHub ends the cookie's GitHub grant, so it is offered only
    // when there is one — not for `GITHUB_TOKEN` beside a GitLab connection.
    const githubFromSession =
      credentials.byForge['github']?.fromSession === true;

    // Each configured host the session holds a usable grant for names its
    // viewer, in the configured order whichever answers first. A host that
    // cannot say who the grant is fails the whole answer, as GitHub's does:
    // left off, the answer would name a session without that connection, and
    // the shared cache would file this one's private answers under it.
    const gitlab = (
      await Promise.all(
        config.gitlabHosts.map(async ({ host }) => {
          const cred =
            credentials.byForge[forgeGroupKey({ forge: 'gitlab', host })];
          if (cred == null) return undefined;
          try {
            const viewer = await forgeNamed('gitlab').viewer(cred, host);
            return viewer == null ? undefined : { host, viewer };
          } catch (error) {
            log.set({ outcome: 'error', host });
            return fail(
              error,
              m.router_could_not_check_who_you_are_signed_in(),
              {
                ref: { forge: 'gitlab', host },
                credentialed: true,
              }
            );
          }
        })
      )
    ).filter((entry) => entry != null);

    const token = credentials.byForge['github']?.token;
    if (token == null) {
      return {
        viewer: undefined,
        fromSession,
        githubFromSession,
        ...(gitlab.length === 0 ? {} : { gitlab }),
      };
    }
    try {
      const viewer = await forgeNamed('github').viewer({ token, fromSession });
      log.set({ outcome: 'ok', viewer: viewer?.login });
      return {
        fromSession,
        githubFromSession,
        viewer,
        ...(gitlab.length === 0 ? {} : { gitlab }),
      };
    } catch (error) {
      log.set({ outcome: 'error' });
      return fail(error, m.router_could_not_check_who_you_are_signed_in(), {
        ref: { forge: 'github' },
        credentialed: true,
      });
    }
  }
);

const listInstallations = os.installations.list.handler(
  async ({ context: { config, log, credentials } }) => {
    const app = config.github.app;
    const installUrl =
      app?.slug == null ? undefined : buildInstallUrl(app.slug);
    const token = credentials.byForge['github']?.token;
    if (token == null) {
      log.set({ outcome: 'anonymous' });
      return { installations: [], installUrl };
    }
    try {
      const installations = await readInstallations(token);
      log.set({ outcome: 'ok', installationCount: installations.length });
      return { installations, installUrl };
    } catch (error) {
      log.set({ outcome: 'error' });
      return fail(error, m.router_could_not_read_where_ghdiff_is_installed(), {
        ref: { forge: 'github' },
        credentialed: true,
      });
    }
  }
);

const listPulls = os.pulls.list.handler(
  async ({ context: { config, log, credentials }, input }) => {
    const repos = dedupeRepoRefs(input.repos).slice(0, MAX_WATCHED_REPOS);
    log.set({
      repoCount: repos.length,
      authenticated: credentials.byForge['github']?.token != null,
    });
    if (repos.length === 0) return { viewers: {}, pulls: [], failures: [] };

    // Each forge group answers its own repositories with its own credential,
    // and one that fails fails only its own rows. A ref for a host this
    // deployment does not serve fails at the gate with the sentence that says
    // what it does serve.
    const byForge = Map.groupBy(repos, (ref) => forgeGroupKey(ref));

    const result: OpenPullsAnswer = { viewers: {}, pulls: [], failures: [] };
    await Promise.all(
      [...byForge.values()].map(async (refs) => {
        try {
          const data = await forgeFor(config, refs[0]).listOpenPulls(
            refs,
            credFor(credentials, refs[0])
          );
          result.pulls.push(...data.pulls);
          result.failures.push(...data.failures);
          // The viewer stays with its own group: a login that matches across
          // forges is not the same person.
          if (data.viewer != null) {
            result.viewers[forgeGroupKey(refs[0])] = data.viewer;
          }
        } catch (error) {
          for (const ref of refs) {
            result.failures.push({
              repo: formatRepoRef(ref),
              message:
                error instanceof GitHubError
                  ? error.message
                  : m.router_could_not_load_this_repository(),
            });
          }
        }
      })
    );

    log.set({
      pullCount: result.pulls.length,
      failureCount: result.failures.length,
      viewers: Object.keys(result.viewers).length,
    });
    return result;
  }
);

const getPull = os.pulls.get
  .use(withForge)
  .handler(async ({ context: { forge, cred, log }, input }) => {
    try {
      const details = await forge.pullDetails(input, cred);
      log.set({ outcome: 'ok', state: details.state });
      return details;
    } catch (error) {
      return fail(error, m.router_could_not_load_this_pull_request(), {
        ref: input,
        credentialed: cred.token != null,
      });
    }
  });

const getMyReview = os.reviews.mine
  .use(withForge)
  .handler(async ({ context: { forge, cred, log }, input }) => {
    try {
      const review = await forge.reviews.mine(input, cred);
      log.set({ outcome: review == null ? 'none' : 'ok' });
      return review == null ? {} : { review };
    } catch (error) {
      return fail(error, m.router_could_not_load_your_review_of_this_pull(), {
        ref: input,
        credentialed: cred.token != null,
      });
    }
  });

const submitReview = os.reviews.submit
  .use(withAuth('review'))
  .handler(async ({ context: { forge, cred, log }, input }) => {
    const { body, event, ...ref } = input;
    log.set({ event });
    try {
      if (!forge.capabilities.verdicts.includes(event)) {
        throw new ORPCError('BAD_REQUEST', {
          status: 400,
          message: m.router_this_forge_does_not_take_that_verdict(),
        });
      }
      const review = await forge.reviews.submit(ref, { event, body }, cred);
      log.set({
        outcome: 'submitted',
        reviewId: review.id,
        state: review.state,
      });
      return review;
    } catch (error) {
      // The forge's own words are worth more than ours here: it is the one
      // that knows a reviewer cannot approve their own pull request.
      return fail(error, m.router_could_not_submit_this_review(), {
        ref: input,
        credentialed: true,
      });
    }
  });

const listComments = os.comments.list
  .use(withForge)
  .handler(async ({ context: { forge, cred, log }, input }) => {
    try {
      const comments = await forge.comments.list(input, cred);
      log.set({ outcome: 'ok', count: comments.length });
      return comments;
    } catch (error) {
      return fail(error, m.router_could_not_load_comments(), {
        ref: input,
        credentialed: cred.token != null,
      });
    }
  });

const createComment = os.comments.create
  .use(withAuth('comment'))
  .handler(async ({ context: { forge, cred, log }, input }) => {
    const {
      body,
      replyToId,
      path,
      line,
      side,
      startLine,
      startSide,
      gitlabPosition,
      ...ref
    } = input;
    log.set({ replyToId });
    try {
      const created = await forge.comments.create(
        ref,
        {
          body,
          replyToId,
          path,
          line,
          side,
          startLine,
          startSide,
          gitlabPosition,
        },
        cred
      );
      log.set({ outcome: 'created', commentId: created.remoteId });
      return created;
    } catch (error) {
      return fail(error, m.router_could_not_post_this_comment(), {
        ref: input,
        credentialed: true,
      });
    }
  });

const removeComment = os.comments.remove
  .use(withAuth('delete'))
  .handler(async ({ context: { forge, cred, log }, input }) => {
    const { commentId, ...ref } = input;
    log.set({ commentId });
    try {
      await forge.comments.remove(ref, commentId, cred);
      log.set({ outcome: 'deleted' });
      return { ok: true as const };
    } catch (error) {
      return fail(error, m.router_could_not_delete_this_comment(), {
        ref: input,
        credentialed: true,
      });
    }
  });

const resolveCommentThread = os.comments.resolve
  .use(withAuth('resolve'))
  .handler(async ({ context: { forge, cred, log }, input }) => {
    const { threadId, resolved, ...ref } = input;
    log.set({ resolved });
    try {
      const resolve = requireCapability(
        forge.comments.resolve,
        m.router_this_forge_resolves_no_review_threads()
      );
      await resolve(ref, { threadId, resolved }, cred);
      log.set({ outcome: 'ok' });
      return { resolved };
    } catch (error) {
      return fail(error, m.router_could_not_resolve_that_thread(), {
        ref: input,
        credentialed: true,
      });
    }
  });

// Anonymous is a first-class caller here, the way it is for `pulls.get`: a
// public review loads with nobody signed in, and both adapters answer an empty
// list to no credential. A grant that exists but is spent is another matter —
// the forge's own 401 becomes the typed `auth-expired` failure through
// `fail`, never an empty list that reads as "nothing staged".
const listDrafts = os.drafts.list
  .use(withForge)
  .handler(async ({ context: { forge, cred, log }, input }) => {
    try {
      const drafts = requireCapability(
        forge.drafts,
        m.router_this_forge_keeps_no_review_drafts()
      );
      const list = await drafts.list(input, cred);
      log.set({ outcome: 'ok', count: list.length });
      return { drafts: list };
    } catch (error) {
      return fail(error, m.router_could_not_load_your_staged_comments(), {
        ref: input,
        credentialed: cred.token != null,
      });
    }
  });

const createDraft = os.drafts.create
  .use(withAuth('stage'))
  .handler(async ({ context: { forge, cred, log }, input }) => {
    const {
      body,
      path,
      line,
      side,
      startLine,
      startSide,
      gitlabPosition,
      ...ref
    } = input;
    try {
      const drafts = requireCapability(
        forge.drafts,
        m.router_this_forge_keeps_no_review_drafts()
      );
      const draft = await drafts.create(
        ref,
        { body, path, line, side, startLine, startSide, gitlabPosition },
        cred
      );
      log.set({ outcome: 'created', commentId: draft.remoteId });
      return draft;
    } catch (error) {
      return fail(error, m.router_could_not_stage_this_comment(), {
        ref: input,
        credentialed: true,
      });
    }
  });

const removeDraft = os.drafts.remove
  .use(withAuth('unstage'))
  .handler(async ({ context: { forge, cred, log }, input }) => {
    const { id, nodeId, ...ref } = input;
    log.set({ commentId: id });
    try {
      const drafts = requireCapability(
        forge.drafts,
        m.router_this_forge_keeps_no_review_drafts()
      );
      await drafts.remove(ref, { id, nodeId }, cred);
      log.set({ outcome: 'deleted' });
      return { ok: true as const };
    } catch (error) {
      return fail(error, m.router_could_not_delete_this_staged_comment(), {
        ref: input,
        credentialed: true,
      });
    }
  });

const listViewedFiles = os.viewedFiles.list
  .use(withForge)
  .handler(async ({ context: { forge, cred, log }, input }) => {
    try {
      const viewedFiles = requireCapability(
        forge.viewedFiles,
        m.router_this_forge_keeps_no_viewed_file_marks()
      );
      const data = await viewedFiles.list(input, cred);
      log.set({ outcome: 'ok', count: data.paths.length });
      return data;
    } catch (error) {
      return fail(error, m.router_could_not_load_which_files_you_have_read(), {
        ref: input,
        credentialed: cred.token != null,
      });
    }
  });

const setViewedFile = os.viewedFiles.set
  .use(withAuth('viewed'))
  .handler(async ({ context: { forge, cred, log }, input }) => {
    const { path, viewed, ...ref } = input;
    log.set({ viewed });
    try {
      const viewedFiles = requireCapability(
        forge.viewedFiles,
        m.router_this_forge_keeps_no_viewed_file_marks()
      );
      await viewedFiles.set(ref, { path, viewed }, cred);
      log.set({ outcome: 'ok' });
      return { ok: true as const };
    } catch (error) {
      return fail(error, m.router_could_not_send_that_mark_to_github(), {
        ref: input,
        credentialed: true,
      });
    }
  });

// A courtesy beside the diff rather than a part of it: no credential, or a
// forge that keeps no such list, answers an empty one rather than asking.
const getTeamReviews = os.reviews.team
  .use(withForge)
  .handler(async ({ context: { forge, cred, log }, input }) => {
    if (cred.token == null || forge.reviews.team == null) {
      return { reviews: [] };
    }
    try {
      const reviews = await forge.reviews.team(input, cred);
      log.set({ outcome: 'ok', reviews: reviews.length });
      return { reviews };
    } catch (error) {
      return fail(
        error,
        m.router_could_not_load_the_teams_reviews_of_this_pull(),
        {
          ref: input,
          credentialed: true,
        }
      );
    }
  });

const listConversation = os.comments.conversation
  .use(withForge)
  .handler(async ({ context: { forge, cred, log }, input }) => {
    if (forge.comments.conversation == null) return [];
    try {
      const entries = await forge.comments.conversation(input, cred);
      log.set({ outcome: 'ok', count: entries.length });
      return entries;
    } catch (error) {
      return fail(error, m.router_could_not_load_the_conversation(), {
        ref: input,
        credentialed: cred.token != null,
      });
    }
  });

const createIssue = os.issues.create
  .use(withTargetForge)
  .handler(async ({ context: { forge, cred, ref, log }, input }) => {
    const { target, ...issue } = input;
    log.set({ side: issue.side });
    if (cred.token == null) throw authRequired('issue', ref);
    try {
      const issues = requireCapability(
        forge.issues,
        m.router_this_forge_files_no_issues()
      );
      const created = await issues.create(target, issue, cred);
      log.set({ outcome: 'created', issue: created.number });
      return created;
    } catch (error) {
      return fail(error, m.router_could_not_create_this_issue(), {
        ref,
        credentialed: true,
      });
    }
  });

const listDeployments = os.deployments.list
  .use(withTargetForge)
  .handler(async ({ context: { forge, cred, ref, log }, input }) => {
    if (forge.deployments == null) return { deployments: [] };
    try {
      const { outcome, ...data } = await forge.deployments(input.target, cred);
      log.set({ outcome, deployments: data.deployments.length });
      return data;
    } catch (error) {
      return fail(error, m.router_could_not_load_the_deployments(), {
        ref,
        credentialed: cred.token != null,
      });
    }
  });

/**
 * The counter behind the footer's "Served" line. It is the one procedure that
 * asks nothing of a forge, so it neither reads the token nor reports a forge
 * failure: a store that cannot answer throws, the browser catches it, and the
 * footer prints no figure at all.
 */
const getServedCount = os.stats.served.handler(async ({ context: { log } }) => {
  const count = await readServedCount();
  log.set({ outcome: 'ok', served: count });
  return { count };
});

export const router = os.router({
  installations: { list: listInstallations },
  viewer: { get: getViewer },
  pulls: { list: listPulls, get: getPull },
  stats: { served: getServedCount },
  deployments: { list: listDeployments },
  reviews: {
    mine: getMyReview,
    team: getTeamReviews,
    submit: submitReview,
  },
  issues: { create: createIssue },
  comments: {
    list: listComments,
    conversation: listConversation,
    create: createComment,
    remove: removeComment,
    resolve: resolveCommentThread,
  },
  drafts: {
    list: listDrafts,
    create: createDraft,
    remove: removeDraft,
  },
  viewedFiles: {
    list: listViewedFiles,
    set: setViewedFile,
  },
});

/** Dedupes refs by their label, first occurrence winning. */
function dedupeRepoRefs(refs: readonly RepoRef[]): RepoRef[] {
  const seen = new Map<string, RepoRef>();
  for (const ref of refs) {
    const key = formatRepoRef(ref).toLowerCase();
    if (!seen.has(key)) seen.set(key, ref);
  }
  return [...seen.values()];
}
