import { implement, ORPCError } from '@orpc/server';

import { contract } from './contract.ts';
import {
  annotationSideFromGitHub,
  type CommentPayload,
  gitHubSideFromAnnotation,
} from '@/lib/comments';
import { requestLog } from '@/lib/logger';
import { toPullDetails } from '@/lib/pullDetails';
import {
  dedupeWatchedRepos,
  formatWatchedRepo,
  type PullSummary,
  type WatchedRepo,
} from '@/lib/pulls';
import { normalizePullStatus, type PullStatusSource } from '@/lib/pullStatus';
import {
  GitHubError,
  type GitHubPullRequest,
  type GitHubReview,
  type GitHubReviewComment,
  type GitHubUser,
  githubGraphQL,
  githubJson,
  githubWrite,
} from '@/lib/server/github';

// The Worker's half of the contract. Nothing here is imported by the browser:
// the client is built from `contract`, which holds no implementation, so this
// module and `@/lib/server/github` under it stay out of the client bundle
// however the hooks are written.

/**
 * What the route hands every procedure. The token is read from the request once,
 * at the edge, so no procedure has to know it travels on a header.
 */
export interface RpcContext {
  token?: string;
}

const os = implement(contract).$context<RpcContext>();

const MAX_WATCHED_REPOS = 25;
/**
 * The newest 100 open pull requests of a repository, which is also the largest
 * page GitHub will answer with — REST caps `per_page` there and GraphQL caps
 * `first`. A repository with more open than that is a repository nobody reads
 * to the end of a list for, and the rail sorts by most recently updated, so the
 * hundred that are cut are the hundred nobody has touched.
 */
const MAX_PULLS_PER_REPO = 100;

/**
 * Turns a failure from GitHub into one the client can read. The status is what
 * survives the trip, so `rateLimitedStatus`'s work upstream still reaches the
 * browser: a quota that is gone is 429 here as it is everywhere else.
 */
function fail(error: unknown, fallback: string): never {
  if (error instanceof GitHubError) {
    throw new ORPCError(codeForStatus(error.status), {
      status: error.status,
      message: error.message,
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
      return status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST';
  }
}

/** Every write needs a token, and saying so beats GitHub's own 401. */
function requireToken(token: string | undefined, action: string): string {
  if (token == null) {
    throw new ORPCError('UNAUTHORIZED', {
      status: 401,
      message: `Add a GitHub token before you ${action}.`,
    });
  }
  return token;
}

const getViewer = os.viewer.get.handler(async ({ context }) => {
  const log = requestLog();
  if (context.token == null) return { viewer: undefined };
  try {
    const user = await githubJson<GitHubUser>('/user', context.token);
    log.set({ outcome: 'ok', viewer: user.login });
    return {
      viewer: {
        login: user.login,
        avatarUrl: user.avatar_url,
        name: user.name,
      },
    };
  } catch (error) {
    log.set({ outcome: 'error' });
    return fail(error, 'Token check failed.');
  }
});

const listPulls = os.pulls.list.handler(async ({ context, input }) => {
  const log = requestLog();
  const repos = dedupeWatchedRepos(input.repos).slice(0, MAX_WATCHED_REPOS);
  log.set({ repoCount: repos.length, authenticated: context.token != null });
  if (repos.length === 0) return { pulls: [], failures: [] };

  const token = context.token;

  // The viewer login decides which pull requests are self review. Without a
  // token there is no viewer, so every author reads as somebody else.
  const viewer =
    token == null
      ? undefined
      : await githubJson<GitHubUser>('/user', token)
          .then((user) => user.login)
          .catch(() => undefined);

  const pulls: PullSummary[] = [];
  const failures: { repo: string; message: string }[] = [];

  await Promise.all(
    repos.map(async (repo) => {
      try {
        pulls.push(
          ...(token == null
            ? await readOpenPullsRest(repo, token)
            : await readOpenPullsGraphQL(repo, token))
        );
      } catch (error) {
        failures.push({
          repo: formatWatchedRepo(repo),
          message:
            error instanceof GitHubError
              ? error.message
              : 'Could not read that repository.',
        });
      }
    })
  );

  log.set({ pullCount: pulls.length, failureCount: failures.length, viewer });
  return { viewer, pulls, failures };
});

const getPull = os.pulls.get.handler(async ({ context, input }) => {
  const log = requestLog();
  const { number, owner, repo } = input;
  log.set({ owner, repo, number, authenticated: context.token != null });
  try {
    const pull = await githubJson<GitHubPullRequest>(
      `/repos/${owner}/${repo}/pulls/${number}`,
      context.token
    );
    const details = toPullDetails(owner, repo, pull);
    log.set({ outcome: 'ok', state: details.state });
    return details;
  } catch (error) {
    return fail(error, 'Could not read that pull request.');
  }
});

const submitReview = os.reviews.submit.handler(async ({ context, input }) => {
  const log = requestLog();
  const { body, event, number, owner, repo } = input;
  log.set({ owner, repo, pull: number, event });
  const token = requireToken(context.token, 'submit a review');

  try {
    // An empty body is left off rather than sent as `""`. GitHub takes both for
    // an approval, and neither is a body, so the shorter request is the honest
    // one. The other two events GitHub refuses without words, which is the
    // answer `canSubmitReview` already gave in the dialog.
    const trimmed = body?.trim();
    const review = await githubWrite<GitHubReview>(
      'POST',
      `/repos/${owner}/${repo}/pulls/${number}/reviews`,
      token,
      {
        event,
        ...(trimmed == null || trimmed.length === 0 ? {} : { body: trimmed }),
      }
    );
    if (review == null) {
      throw new ORPCError('BAD_GATEWAY', {
        status: 502,
        message: 'GitHub accepted the review but returned nothing.',
      });
    }
    log.set({ outcome: 'submitted', reviewId: review.id, state: review.state });
    return {
      id: review.id,
      state: review.state,
      submittedAt: review.submitted_at ?? undefined,
      htmlUrl: review.html_url,
    };
  } catch (error) {
    // GitHub's own words are worth more than ours here: it is the one that
    // knows a reviewer cannot approve their own pull request.
    return fail(error, 'That review was not submitted.');
  }
});

const listComments = os.comments.list.handler(async ({ context, input }) => {
  const log = requestLog();
  const { number, owner, repo } = input;
  log.set({ owner, repo, pull: number });
  try {
    const comments = await githubJson<GitHubReviewComment[]>(
      `/repos/${owner}/${repo}/pulls/${number}/comments?per_page=100`,
      context.token
    );
    log.set({ outcome: 'ok', count: comments.length });
    return comments.map(toPayload);
  } catch (error) {
    return fail(error, 'Could not read those comments.');
  }
});

const createComment = os.comments.create.handler(async ({ context, input }) => {
  const log = requestLog();
  const { number, owner, repo } = input;
  log.set({ owner, repo, pull: number });
  const token = requireToken(context.token, 'comment');

  try {
    // A reply names only the comment it answers. Everything else about where it
    // lands, the path, the line, the side and the commit, comes from that
    // comment, so a reply cannot drift off its thread.
    if (input.replyToId != null) {
      log.set({ replyToId: input.replyToId });
      const reply = await githubWrite<GitHubReviewComment>(
        'POST',
        `/repos/${owner}/${repo}/pulls/${number}/comments/${String(input.replyToId)}/replies`,
        token,
        { body: input.body }
      );
      if (reply == null) {
        throw new ORPCError('BAD_GATEWAY', {
          status: 502,
          message: 'GitHub accepted the reply but returned nothing.',
        });
      }
      log.set({ outcome: 'replied', commentId: reply.id });
      return toPayload(reply);
    }

    if (input.path == null || input.line == null) {
      throw new ORPCError('BAD_REQUEST', {
        status: 400,
        message: 'That comment is missing a path or a line.',
      });
    }

    // A review comment must name the commit it applies to.
    const pullRequest = await githubJson<GitHubPullRequest>(
      `/repos/${owner}/${repo}/pulls/${number}`,
      token
    );

    const created = await githubWrite<GitHubReviewComment>(
      'POST',
      `/repos/${owner}/${repo}/pulls/${number}/comments`,
      token,
      {
        body: input.body,
        commit_id: pullRequest.head.sha,
        path: input.path,
        line: input.line,
        side: gitHubSideFromAnnotation(input.side ?? 'additions'),
        ...(input.startLine != null && input.startLine !== input.line
          ? {
              start_line: input.startLine,
              start_side: gitHubSideFromAnnotation(
                input.startSide ?? 'additions'
              ),
            }
          : {}),
      }
    );
    if (created == null) {
      throw new ORPCError('BAD_GATEWAY', {
        status: 502,
        message: 'GitHub accepted the comment but returned nothing.',
      });
    }
    log.set({ outcome: 'created', commentId: created.id });
    return toPayload(created);
  } catch (error) {
    if (error instanceof ORPCError) throw error;
    return fail(error, 'That comment request failed.');
  }
});

const removeComment = os.comments.remove.handler(async ({ context, input }) => {
  const log = requestLog();
  const { commentId, owner, repo } = input;
  log.set({ owner, repo, commentId });
  const token = requireToken(context.token, 'delete a comment');
  try {
    await githubWrite(
      'DELETE',
      `/repos/${owner}/${repo}/pulls/comments/${commentId}`,
      token
    );
    log.set({ outcome: 'deleted' });
    return { ok: true as const };
  } catch (error) {
    return fail(error, 'That delete failed.');
  }
});

export const router = os.router({
  viewer: { get: getViewer },
  pulls: { list: listPulls, get: getPull },
  reviews: {
    submit: submitReview,
  },
  comments: {
    list: listComments,
    create: createComment,
    remove: removeComment,
  },
});

function toPayload(comment: GitHubReviewComment): CommentPayload {
  const side = annotationSideFromGitHub(comment.side ?? 'RIGHT');
  // GitHub reports `line: null` for a comment whose line fell out of the diff
  // after a force push. `original_line` still points at where it was written.
  const line = comment.line ?? comment.original_line ?? 1;
  const startLine = comment.start_line ?? comment.original_start_line;
  return {
    githubId: comment.id,
    path: comment.path,
    author: comment.user?.login ?? 'unknown',
    authorAvatarUrl: comment.user?.avatar_url,
    // GitHub types an App's account as 'Bot'. The sidebar's People and Bots
    // filter reads this rather than guessing from the login.
    authorIsBot: comment.user?.type === 'Bot',
    body: comment.body,
    line,
    startLine: startLine ?? undefined,
    side,
    startSide:
      comment.start_side == null
        ? undefined
        : annotationSideFromGitHub(comment.start_side),
    createdAt: comment.created_at,
    htmlUrl: comment.html_url,
    replyToId: comment.in_reply_to_id,
  };
}

// `reviews(last: 1, states: [CHANGES_REQUESTED])` is the one review that
// matters here: the newest request for changes, so the author's newest commit
// can be compared against it.
const OPEN_PULLS_QUERY = `
query($owner:String!,$repo:String!,$first:Int!){
  repository(owner:$owner,name:$repo){
    pullRequests(states:OPEN,first:$first,orderBy:{field:UPDATED_AT,direction:DESC}){
      nodes{
        number title url isDraft updatedAt
        headRefName baseRefName headRefOid reviewDecision
        author{ login avatarUrl }
        commits(last:1){nodes{commit{oid committedDate statusCheckRollup{state}}}}
        reviews(last:1,states:[CHANGES_REQUESTED]){nodes{submittedAt}}
      }
    }
  }
}`;

interface GraphQLPullNode extends PullStatusSource {
  number?: number | null;
  title?: string | null;
  url?: string | null;
  isDraft?: boolean | null;
  updatedAt?: string | null;
  headRefName?: string | null;
  baseRefName?: string | null;
  author?: { login?: string | null; avatarUrl?: string | null } | null;
}

interface OpenPullsQueryData {
  repository?: {
    pullRequests?: { nodes?: (GraphQLPullNode | null)[] | null } | null;
  } | null;
}

/** The list with its review decision and its check rollup. Needs a token. */
async function readOpenPullsGraphQL(
  repo: WatchedRepo,
  token: string
): Promise<PullSummary[]> {
  const data = await githubGraphQL<OpenPullsQueryData>(
    OPEN_PULLS_QUERY,
    { owner: repo.owner, repo: repo.repo, first: MAX_PULLS_PER_REPO },
    token
  );
  // A token that cannot see the repository gets a 200 with a null repository.
  if (data.repository == null) {
    throw new GitHubError(404, 'Not Found');
  }

  const pulls: PullSummary[] = [];
  for (const node of data.repository.pullRequests?.nodes ?? []) {
    if (node == null || typeof node.number !== 'number') continue;
    pulls.push({
      owner: repo.owner,
      repo: repo.repo,
      number: node.number,
      title: node.title ?? '',
      author: node.author?.login ?? 'unknown',
      authorAvatarUrl: node.author?.avatarUrl ?? undefined,
      // The query asks for open pull requests only, so the lifecycle is either
      // open or draft.
      state: node.isDraft === true ? 'draft' : 'open',
      htmlUrl: node.url ?? '',
      updatedAt: node.updatedAt ?? '',
      headRef: node.headRefName ?? '',
      baseRef: node.baseRefName ?? '',
      status: normalizePullStatus(node),
    });
  }
  return pulls;
}

/** The same list without the two status axes, for a reviewer with no token. */
async function readOpenPullsRest(
  repo: WatchedRepo,
  token: string | undefined
): Promise<PullSummary[]> {
  const result = await githubJson<GitHubPullRequest[]>(
    `/repos/${repo.owner}/${repo.repo}/pulls?state=open&sort=updated&direction=desc&per_page=${MAX_PULLS_PER_REPO}`,
    token
  );
  return result.map((pull) => ({
    owner: repo.owner,
    repo: repo.repo,
    number: pull.number,
    title: pull.title,
    author: pull.user?.login ?? 'unknown',
    authorAvatarUrl: pull.user?.avatar_url,
    state: pull.draft === true ? 'draft' : 'open',
    htmlUrl: pull.html_url,
    updatedAt: pull.updated_at,
    headRef: pull.head.ref,
    baseRef: pull.base.ref,
  }));
}
