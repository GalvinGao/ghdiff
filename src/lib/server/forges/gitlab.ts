import {
  type Camelize,
  type CommitDiffSchema,
  Commits,
  type DiscussionNotePositionOptions,
  type DiscussionNotePositionTextSchema,
  MergeRequestApprovals,
  MergeRequestDiscussions,
  type MergeRequestDraftNotePositionSchema,
  MergeRequestDraftNotes,
  MergeRequestNotes,
  MergeRequests,
  Repositories,
  Users,
} from '@gitbeaker/core';
import {
  createRequesterFn,
  type FormattedResponse,
  GitbeakerRequestError,
} from '@gitbeaker/requester-utils';

import {
  MY_MERGE_REQUEST_APPROVAL_QUERY,
  OPEN_MERGE_REQUESTS_QUERY,
} from './gitlab.gql';
import type { TypedDocumentString } from './gqlgen/gitlab/graphql';
import { streamMedia } from './media';
import type {
  Forge,
  ForgeCredential,
  GitLabPositionCursor,
  GitLabPositionInput,
} from './types';
import { isGitLabBotLogin } from '@/lib/commentAuthors';
import type { CommentPayload } from '@/lib/comments';
import { formatRepoRef, type PullRef } from '@/lib/forges';
import type { RequestLog } from '@/lib/logger';
import type { OpenPullsData, PullSummary } from '@/lib/pulls';
import {
  checkStateFromGitLabPipeline,
  pullStatusFromGitLab,
} from '@/lib/pullStatus';
import type { GitLabTarget } from '@/lib/reviewTarget';
import { GitHubError, USER_AGENT } from '@/lib/server/github/client';
import {
  describeSynthesisGaps,
  synthesizePatch,
} from '@/lib/server/github/patch';
import {
  API_VERSION,
  gitLabErrorMessage,
  gitLabHeaders as headers,
} from '@/lib/server/gitlab/api';
import { readGitLabDeployments } from '@/lib/server/gitlab/deployments';
import { createGitLabIssue } from '@/lib/server/gitlab/issue';
import { readConversation, readTeamReviews } from '@/lib/server/gitlab/reviews';
import { textResponse } from '@/lib/server/plainText';

/**
 * A full commit sha, the one ref that never moves: a diff or a file read at
 * one is the same bytes forever, which is what lets an ETag be written for it
 * without asking the instance.
 */
const FULL_SHA = /^[0-9a-f]{40}$/i;

/**
 * The ETag this server writes for an answer the instance states none for,
 * from the commits it was read at. Weak, because it vouches for what the
 * bytes mean and not for the bytes: a synthesized patch and a raw one of the
 * same commits are the same diff.
 */
function shaTag(target: GitLabTarget, ...parts: string[]): string {
  // The project rides in the tag, so a copy one project's read vouched for is
  // never confirmed for another that happens to hold the same commits.
  const project = encodeURIComponent(`${target.host}/${target.project}`);
  return `W/"gl-${project}-${parts.join('-')}"`;
}

/** The answer when the browser's copy is current: 304, no body. */
function unchanged(etag: string, log?: RequestLog): Response {
  log?.set({ outcome: 'unchanged' });
  return textResponse(null, { status: 304, etag });
}

/** The same answer with its ETag beside it, so the next load can ask. */
function tagged(response: Response, etag: string | undefined): Response {
  if (etag != null) response.headers.set('etag', etag);
  return response;
}
import { m } from '@/paraglide/messages.js';

// The GitLab forge. JSON goes through gitbeaker; the two plain-text hot paths
// — a merge request's `raw_diffs` stream and a whole file's raw stream — are
// hand-rolled fetch, the same split the GitHub forge makes and for the same
// reason. The host travels with the target, so one implementation answers for
// gitlab.com and every self-hosted instance alike.
//
// The resources come from `@gitbeaker/core` rather than the preconfigured
// `@gitbeaker/rest`: the rest bundle's presets are about 22 KiB of gzipped
// Worker this app has no use for, so the requester is built here from the
// SDK's own seams — `createRequesterFn` and `defaultOptionsHandler`, which
// own the auth headers, the query building and the error class.
//
// What GitLab has no answer for is absent from the object, and
// `capabilities` below already says so.

/**
 * The one HTTP executor every gitbeaker call goes through. It mirrors the
 * SDK's own default handler minus its retry loop — a 429 or a 502 reaches the
 * app's own failure wording rather than being retried silently — and names
 * the app's user agent.
 */
async function requestHandler(
  endpoint: string,
  options: Record<string, unknown> = {}
) {
  const { prefixUrl, searchParams, method, ...init } = options as {
    prefixUrl?: string;
    searchParams?: string;
    method?: string;
  } & Record<string, unknown>;
  const baseUrl =
    prefixUrl == null
      ? undefined
      : prefixUrl.endsWith('/')
        ? prefixUrl
        : `${prefixUrl}/`;
  const url = new URL(endpoint, baseUrl);
  url.search = searchParams ?? '';

  const requestHeaders = new Headers(init.headers as HeadersInit | undefined);
  if (!requestHeaders.has('user-agent')) {
    requestHeaders.set('user-agent', USER_AGENT);
  }
  const request = new Request(url, {
    ...init,
    method,
    headers: requestHeaders,
  });
  const response = await fetch(request);

  if (!response.ok) {
    const description = gitLabErrorMessage(
      await response.text(),
      response.statusText
    );
    throw new GitbeakerRequestError(description, {
      cause: { description, request, response },
    });
  }

  const contentType = response.headers.get('content-type') ?? '';
  const body =
    response.status === 204
      ? null
      : contentType.includes('application/json')
        ? await response.json()
        : await response.text();
  return {
    body,
    headers: Object.fromEntries(response.headers.entries()),
    status: response.status,
  } as FormattedResponse;
}

const requesterFn = createRequesterFn(
  (_serviceOptions, requestOptions) => Promise.resolve(requestOptions),
  requestHandler
);

function tokenOptions(cred: ForgeCredential): {
  token?: string;
  oauthToken?: string;
} {
  if (cred.token == null) return {};
  return cred.scheme === 'private-token'
    ? { token: cred.token }
    : { oauthToken: cred.token };
}

function clients(host: string, cred: ForgeCredential) {
  // gitbeaker wants the instance as a full URL, not a bare hostname.
  const options = {
    host: `https://${host}`,
    requesterFn,
    ...tokenOptions(cred),
  };
  return {
    mrs: new MergeRequests(options),
    commits: new Commits(options),
    repos: new Repositories(options),
    users: new Users(options),
    discussions: new MergeRequestDiscussions(options),
    notes: new MergeRequestNotes(options),
    approvals: new MergeRequestApprovals(options),
    draftNotes: new MergeRequestDraftNotes(options),
  };
}

/**
 * Whether the project is visible on the host: `/api/resolve`'s probe, one GET
 * per configured host. Visibility is all that is asked — a 2xx shows the
 * project to this credential, anonymous or not, and every other answer reads
 * as not-visible, a network failure included, so the next host is asked. It
 * is not on the `Forge` interface: which host a project lives on is a
 * deployment question, not a review operation.
 */
export async function gitLabProjectVisible(
  host: string,
  project: string,
  cred: ForgeCredential
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://${host}${API_VERSION}/projects/${encodeURIComponent(project)}`,
      { cache: 'no-store', headers: headers(cred) }
    );
    // The body says nothing the status did not; reading it out is what frees
    // the socket. (Canceling it would too, but a canceled stream never
    // settles under the test mock.)
    await response.text();
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Every failure becomes the app's own shape. GitLab reports a spent quota as
 * 429 itself, so unlike the GitHub side there is no 403 to disambiguate.
 */
function toGitLabError(error: unknown): GitHubError {
  if (error instanceof GitHubError) return error;
  if (error instanceof GitbeakerRequestError) {
    const status = error.cause?.response?.status ?? 502;
    const description = error.cause?.description;
    return new GitHubError(
      status,
      typeof description === 'string' && description.length > 0
        ? description
        : error.message
    );
  }
  return new GitHubError(
    502,
    error instanceof Error
      ? error.message
      : m.forge_that_request_to_gitlab_failed()
  );
}

/** A call through gitbeaker, with failures normalized. */
async function call<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    throw toGitLabError(error);
  }
}

/**
 * A GraphQL call against the instance. Bulk state REST cannot serve — every
 * merge request's approval and pipeline in one query — goes through here,
 * typed by the generated documents; everything else stays on gitbeaker.
 * A 200 with no `data` is a failure, not an answer; a 200 with both `data`
 * and `errors` answers with the data, and the caller reads the fields that
 * came back null.
 */
async function gql<TData, TVars extends Record<string, unknown>>(
  host: string,
  cred: ForgeCredential,
  document: TypedDocumentString<TData, TVars>,
  variables: TVars
): Promise<TData> {
  const response = await fetch(`https://${host}/api/graphql`, {
    method: 'POST',
    cache: 'no-store',
    headers: { ...headers(cred), 'content-type': 'application/json' },
    body: JSON.stringify({ query: document.toString(), variables }),
  });
  if (!response.ok) {
    throw new GitHubError(
      response.status,
      gitLabErrorMessage(await response.text(), response.statusText)
    );
  }
  const envelope = (await response.json()) as {
    data?: TData | null;
    errors?: { message?: string }[];
  };
  if (envelope.data == null) {
    const first = envelope.errors?.[0]?.message;
    throw new GitHubError(
      200,
      first ?? m.forge_gitlab_returned_no_data_for_that_query()
    );
  }
  return envelope.data;
}

/** The ref as this forge's own, which every procedure needs and the union does not know. */
function gitLabRef(ref: PullRef): Extract<PullRef, { forge: 'gitlab' }> {
  if (ref.forge !== 'gitlab') throw new GitHubError(400, 'Not a GitLab ref.');
  return ref;
}

/** A streamed GET against the instance, for the two plain-text paths. */
async function stream(
  host: string,
  path: string,
  cred: ForgeCredential
): Promise<Response> {
  const response = await fetch(`https://${host}${API_VERSION}${path}`, {
    cache: 'no-store',
    headers: headers(cred),
  });
  if (!response.ok) {
    throw new GitHubError(
      response.status,
      gitLabErrorMessage(await response.text(), response.statusText)
    );
  }
  return response;
}

/**
 * The API path for a markdown upload, when the address is one. Three forms
 * arrive: the body's own `/uploads/<secret>/<name>`, the v1 web path that
 * renders to (`/<project>/uploads/...`), and the v2 id-based one
 * (`/-/project/<id>/uploads/...`). All three download through the project
 * markdown uploads API, which takes the reviewer's API grant with the Guest
 * role — the web paths answer only to a browser session, which an API token
 * is not.
 */
function uploadApiPath(
  gitlab: GitLabTarget,
  pathname: string
): string | undefined {
  const projectUpload = (
    project: string,
    secret: string,
    filename: string
  ): string | undefined => {
    // The filename arrives percent-encoded — it is one segment of the
    // address — and the API path carries it encoded exactly once, so an
    // already-encoded name is decoded before the one encoding. A malformed
    // escape names no file the instance can answer for.
    let decoded: string;
    try {
      decoded = decodeURIComponent(filename);
    } catch {
      return undefined;
    }
    return `/projects/${project}/uploads/${secret}/${encodeURIComponent(decoded)}`;
  };
  const body = pathname.match(/^\/uploads\/([^/]+)\/([^/]+)$/);
  if (body != null) {
    const [, secret, filename] = body;
    return projectUpload(encodeURIComponent(gitlab.project), secret, filename);
  }
  const projectUploads = `/${gitlab.project}/uploads/`;
  if (pathname.startsWith(projectUploads)) {
    const rest = pathname.slice(projectUploads.length);
    const match = rest.match(/^([^/]+)\/([^/]+)$/);
    if (match == null) return undefined;
    const [, secret, filename] = match;
    return projectUpload(encodeURIComponent(gitlab.project), secret, filename);
  }
  const byId = pathname.match(
    /^\/-\/project\/(\d+)\/uploads\/([^/]+)\/([^/]+)$/
  );
  if (byId != null) {
    const [, id, secret, filename] = byId;
    return projectUpload(id, secret, filename);
  }
  return undefined;
}

/**
 * Where a comment body's image is fetched from. An upload goes through the
 * markdown uploads API; any other address on the instance's own host is
 * fetched as given. An address on any other host is refused — the proxy is
 * not a credentialed GET of wherever the markup pointed.
 */
function mediaUrl(gitlab: GitLabTarget, url: string): string {
  if (url.startsWith('/') && !url.startsWith('//')) {
    const api = uploadApiPath(gitlab, url);
    if (api != null) return `https://${gitlab.host}${API_VERSION}${api}`;
    throw new GitHubError(400, m.forge_that_image_address_is_not_valid());
  }
  let parsed: URL;
  try {
    parsed = new URL(url.startsWith('//') ? `https:${url}` : url);
  } catch {
    throw new GitHubError(400, m.forge_that_image_address_is_not_valid());
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.host.toLowerCase() !== gitlab.host.toLowerCase()
  ) {
    throw new GitHubError(400, m.forge_that_image_is_not_on_this_instance());
  }
  const api = uploadApiPath(gitlab, parsed.pathname);
  if (api != null) return `https://${gitlab.host}${API_VERSION}${api}`;
  return parsed.toString();
}

// --- The diff paths ---------------------------------------------------------------

/**
 * A file diff as GitLab's JSON reports it: the SDK's schema plus the two
 * flags it does not name — `too_large` and `collapsed` are how the instance
 * marks a file it would not render. The commit schema is the narrower of
 * the two the endpoints answer with, so the merge-request one flows too.
 */
type GitLabFileDiff = CommitDiffSchema & {
  too_large?: boolean;
  collapsed?: boolean;
};

/**
 * One GitLab JSON file diff as a synthesizable file. The per-file addition
 * and deletion counts GitHub reports have no GitLab counterpart, and the
 * synthesis does not read them.
 */
function pullFileFromGitLab(diff: GitLabFileDiff) {
  const status =
    diff.new_file === true
      ? 'added'
      : diff.deleted_file === true
        ? 'removed'
        : diff.renamed_file === true
          ? 'renamed'
          : 'modified';
  return {
    filename: diff.new_path,
    status,
    additions: 0,
    deletions: 0,
    previous_filename: diff.renamed_file === true ? diff.old_path : undefined,
    // An empty `diff` and a `too_large` flag both mean the instance judged
    // the file too big to render: no hunks, and the notice says so.
    patch:
      diff.too_large === true || diff.diff == null || diff.diff.length === 0
        ? undefined
        : diff.diff,
  };
}

function synthesizedPatch(diffs: readonly GitLabFileDiff[], timedOut = false) {
  const result = synthesizePatch(diffs.map(pullFileFromGitLab));
  const notes: string[] = [];
  if (timedOut) {
    notes.push(m.forge_gitlab_timed_out_comparing_these_refs_so_the_diff());
  }
  const gaps = describeSynthesisGaps(result, false, 'GitLab');
  if (gaps != null) notes.push(gaps);
  const notice = notes.length === 0 ? undefined : notes.join(' ');
  return textResponse(result.patch, { notice });
}

/** All pages of an MR's per-file diffs, at the page size GitLab caps. */
async function allMrDiffs(
  host: string,
  cred: ForgeCredential,
  project: string,
  number: number
): Promise<GitLabFileDiff[]> {
  const { mrs } = clients(host, cred);
  const answer = await call(() =>
    mrs.allDiffs(project, number, { showExpanded: true, perPage: 100 })
  );
  return answer.data;
}

async function mergeRequestDiff(
  target: GitLabTarget & { kind: 'gitlab-mr' },
  cred: ForgeCredential,
  log: RequestLog,
  ifNoneMatch: string | undefined
): Promise<Response> {
  const project = encodeURIComponent(target.project);

  // The commits the diff runs between, read first: a merge request's diff is
  // its `diff_refs` and nothing else, so a browser that kept the diff of the
  // same three commits is told it is current without the patch being read
  // again — which is the expensive half. A read that fails here leaves the
  // answer untagged and the diff paths below to say what went wrong.
  let etag: string | undefined;
  try {
    const { mrs } = clients(target.host, cred);
    const mr = await call(() => mrs.show(target.project, target.number));
    const refs = mr.diff_refs as
      | { base_sha?: string; head_sha?: string; start_sha?: string }
      | undefined;
    if (refs?.base_sha != null && refs.head_sha != null) {
      etag = shaTag(
        target,
        'mr',
        refs.base_sha,
        refs.start_sha ?? refs.base_sha,
        refs.head_sha
      );
    }
  } catch {
    etag = undefined;
  }
  if (etag != null && ifNoneMatch === etag) return unchanged(etag, log);

  // 1. The raw diff endpoint: plain text, whole, and it streams. GitLab older
  //    than 15.7 has no such endpoint and answers 404, so a failure falls
  //    through to the JSON per-file list rather than to the reviewer.
  let rawFailure: GitHubError | undefined;
  try {
    const response = await stream(
      target.host,
      `/projects/${project}/merge_requests/${target.number}/raw_diffs`,
      cred
    );
    log.set({ outcome: 'ok', source: 'raw-diffs' });
    return textResponse(response.body, { etag });
  } catch (error) {
    rawFailure = toGitLabError(error);
  }

  // 2. The JSON per-file list, stitched back into a patch.
  try {
    const diffs = await allMrDiffs(
      target.host,
      cred,
      target.project,
      target.number
    );
    log.set({
      outcome: 'ok',
      source: 'mr-diffs-json',
      fileCount: diffs.length,
    });
    return tagged(synthesizedPatch(diffs), etag);
  } catch (error) {
    // Both failed. The raw attempt's 404 on a current instance is the honest
    // answer; an older one merely lacks the endpoint, and the JSON failure is
    // the one that knows whether the merge request exists.
    throw rawFailure.status === 404 && toGitLabError(error).status !== 404
      ? rawFailure
      : toGitLabError(error);
  }
}

async function commitDiff(
  target: GitLabTarget & { kind: 'gitlab-commit' },
  cred: ForgeCredential,
  log: RequestLog,
  ifNoneMatch: string | undefined
): Promise<Response> {
  // A commit addressed by its full sha is the same diff forever.
  const etag = FULL_SHA.test(target.sha)
    ? shaTag(target, 'commit', target.sha.toLowerCase())
    : undefined;
  if (etag != null && ifNoneMatch === etag) return unchanged(etag, log);
  const { commits } = clients(target.host, cred);
  const answer = await call(() =>
    commits.showDiff(target.project, target.sha, {
      showExpanded: true,
      perPage: 100,
    })
  );
  const diffs = answer.data;
  log.set({
    outcome: 'ok',
    source: 'commit-diff-json',
    fileCount: diffs.length,
  });
  return tagged(synthesizedPatch(diffs), etag);
}

async function compareDiff(
  target: GitLabTarget & { kind: 'gitlab-compare' },
  cred: ForgeCredential,
  log: RequestLog,
  ifNoneMatch: string | undefined
): Promise<Response> {
  // Only a range between two full shas stands still; one that names a branch
  // moves with every push to it, and is read afresh every time.
  const etag =
    FULL_SHA.test(target.base) && FULL_SHA.test(target.head)
      ? shaTag(
          target,
          'compare',
          target.base.toLowerCase(),
          target.head.toLowerCase()
        )
      : undefined;
  if (etag != null && ifNoneMatch === etag) return unchanged(etag, log);
  const { repos } = clients(target.host, cred);
  const answer = await call(() =>
    repos.compare(target.project, target.base, target.head)
  );
  const diffs = answer.diffs ?? [];
  log.set({ outcome: 'ok', source: 'compare-json', fileCount: diffs.length });
  // A comparison GitLab could not finish in time arrives with
  // `compare_timeout` and the files it had already diffed — a partial list
  // that reads exactly like a whole one, so the notice says so.
  // A partial answer is never vouched for: the next load asks again.
  const timedOut = answer.compare_timeout === true;
  return tagged(synthesizedPatch(diffs, timedOut), timedOut ? undefined : etag);
}

// --- The whole file -----------------------------------------------------------------

/**
 * The ref the file's new side is read at. A merge request answers with its
 * head sha, which costs one MR read; a commit answers with itself; a compare
 * range answers with its head, which GitLab reads as a branch or a sha
 * without a second request.
 */
async function newSideRef(
  target: GitLabTarget,
  cred: ForgeCredential
): Promise<string> {
  switch (target.kind) {
    case 'gitlab-mr': {
      const { mrs } = clients(target.host, cred);
      const mr = await call(() => mrs.show(target.project, target.number));
      if (typeof mr.sha !== 'string' || mr.sha.length === 0) {
        throw new GitHubError(
          502,
          m.forge_gitlab_did_not_name_this_merge_requests_head()
        );
      }
      return mr.sha;
    }
    case 'gitlab-commit':
      return target.sha;
    case 'gitlab-compare':
      return target.head;
  }
}

export const gitLabForge: Forge = {
  capabilities: {
    // GitLab has approvals and comments, and no request-changes state. The
    // dialog gates on this.
    verdicts: ['APPROVE', 'COMMENT'],
  },

  diff(target, cred, log, ifNoneMatch) {
    const gitlab = target as GitLabTarget;
    switch (gitlab.kind) {
      case 'gitlab-mr':
        return mergeRequestDiff(gitlab, cred, log, ifNoneMatch);
      case 'gitlab-commit':
        return commitDiff(gitlab, cred, log, ifNoneMatch);
      case 'gitlab-compare':
        return compareDiff(gitlab, cred, log, ifNoneMatch);
    }
  },

  async file(target, path, cred, ifNoneMatch) {
    const gitlab = target as GitLabTarget;
    const ref = await newSideRef(gitlab, cred);
    // A file at a full sha is the same bytes forever, so the copy a browser
    // kept is current without asking the instance for the file again.
    const etag = FULL_SHA.test(ref)
      ? shaTag(gitlab, 'file', ref.toLowerCase(), encodeURIComponent(path))
      : undefined;
    if (etag != null && ifNoneMatch === etag) return unchanged(etag);
    const response = await stream(
      gitlab.host,
      `/projects/${encodeURIComponent(gitlab.project)}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`,
      cred
    );
    if (etag == null) return response;
    // Re-wrapped, because a fetched answer's headers cannot be written to.
    // Its own headers ride along — the route reads `content-length` off them
    // to refuse a file past the cap before a byte of it is read.
    const withEtag = new Headers(response.headers);
    withEtag.set('etag', etag);
    return new Response(response.body, {
      status: response.status,
      headers: withEtag,
    });
  },

  // Async so a refused address rejects rather than throwing synchronously.
  async media(target, url, cred) {
    return streamMedia(mediaUrl(target as GitLabTarget, url), cred, headers);
  },

  async viewer(cred, host) {
    if (cred.token == null) return undefined;
    if (host == null) throw new GitHubError(400, 'GitLab viewer needs a host.');
    const { users } = clients(host, cred);
    const user = await call(() => users.showCurrentUser());
    if (user.username == null) return undefined;
    return {
      login: user.username,
      avatarUrl: user.avatar_url,
      name: user.name,
    };
  },
  async listOpenPulls(repos, cred): Promise<OpenPullsData> {
    const pulls: PullSummary[] = [];
    const failures: { repo: string; message: string }[] = [];

    if (cred.token == null) {
      // Without a token there is no viewer and no status at all, the way
      // GitHub's anonymous list works — and the read is the REST list it
      // always was.
      await Promise.all(
        repos.map(async (ref) => {
          if (ref.forge !== 'gitlab') return;
          try {
            const { mrs } = clients(ref.host, cred);
            const answer = await call(() =>
              mrs.all({
                projectId: ref.project,
                state: 'opened',
                orderBy: 'updated_at',
                sort: 'desc',
                showExpanded: true,
                // One page, the same hundred the GitHub forge caps a
                // repository at: without `maxPages` gitbeaker follows every
                // `rel="next"`.
                perPage: 100,
                maxPages: 1,
              })
            );
            const list = answer.data;
            for (const mr of list) {
              pulls.push({
                owner: ref.host,
                repo: ref.project,
                forge: 'gitlab',
                host: ref.host,
                project: ref.project,
                number: mr.iid ?? 0,
                title: mr.title ?? '',
                author: mr.author?.username ?? 'unknown',
                authorAvatarUrl: mr.author?.avatar_url,
                state: mr.draft === true ? 'draft' : 'open',
                htmlUrl: mr.web_url ?? '',
                updatedAt: mr.updated_at ?? '',
                headRef: mr.source_branch ?? '',
                baseRef: mr.target_branch ?? '',
              });
            }
          } catch (error) {
            failures.push({
              repo: formatRepoRef(ref),
              message:
                error instanceof GitHubError
                  ? error.message
                  : m.forge_could_not_load_this_project(),
            });
          }
        })
      );
      return { viewer: undefined, pulls, failures };
    }

    // One GraphQL query per project, in parallel, carrying every merge
    // request's approval and pipeline with it — the state REST answers only
    // per merge request, one serial call each. Each query also carries the
    // viewer login that decides which merge requests are self review, so the
    // first answer names it for the group.
    let viewer: string | undefined;
    await Promise.all(
      repos.map(async (ref) => {
        if (ref.forge !== 'gitlab') return;
        try {
          const data = await gql(ref.host, cred, OPEN_MERGE_REQUESTS_QUERY, {
            path: ref.project,
            first: 100,
          });
          viewer ??= data.currentUser?.username ?? undefined;
          // A token that cannot see the project gets a 200 with a null one.
          if (data.project == null) {
            throw new GitHubError(404, m.forge_gitlab_found_no_such_project());
          }
          const viewerName = data.currentUser?.username?.toLowerCase();
          for (const node of data.project.mergeRequests?.nodes ?? []) {
            if (node == null) continue;
            // A null `approvedBy` is the field the instance would not show
            // this token: the row keeps its pipeline half and loses the
            // review one, the way a 403 from the approvals endpoint read.
            const approved =
              node.approvedBy == null
                ? undefined
                : (node.approvedBy.nodes ?? []).length > 0;
            // Presence in the reviewers list is what the instance's own
            // "requested to review" means.
            const reviewRequested =
              viewerName != null &&
              (node.reviewers?.nodes ?? []).some(
                (reviewer) =>
                  reviewer != null &&
                  reviewer.username.toLowerCase() === viewerName
              );
            pulls.push({
              owner: ref.host,
              repo: ref.project,
              forge: 'gitlab',
              host: ref.host,
              project: ref.project,
              number: Number.parseInt(node.iid, 10) || 0,
              title: node.title,
              author: node.author?.username ?? 'unknown',
              authorAvatarUrl: node.author?.avatarUrl ?? undefined,
              state: node.draft ? 'draft' : 'open',
              htmlUrl: node.webUrl ?? '',
              updatedAt: node.updatedAt,
              headRef: node.sourceBranch,
              baseRef: node.targetBranch,
              status: pullStatusFromGitLab({
                approved,
                pipeline: node.headPipeline?.status?.toLowerCase(),
              }),
              reviewRequested: reviewRequested || undefined,
            });
          }
        } catch (error) {
          failures.push({
            repo: formatRepoRef(ref),
            message:
              error instanceof GitHubError
                ? error.message
                : m.forge_could_not_load_this_project(),
          });
        }
      })
    );

    return { viewer, pulls, failures };
  },

  async pullDetails(ref, cred) {
    ref = gitLabRef(ref);
    const { mrs } = clients(ref.host, cred);
    const mr = await call(() => mrs.show(ref.project, ref.number));
    const body = mr.description?.trim();
    const changedFiles = Number(mr.changes_count);
    // The check axis rides the same payload, but the list's rule stands here
    // too: no token, no status — the favicon badge stays off rather than
    // claim "no checks" about a merge request it never asked about.
    const check =
      cred.token == null
        ? undefined
        : checkStateFromGitLabPipeline(mr.head_pipeline?.status?.toLowerCase());
    return {
      owner: ref.host,
      repo: ref.project,
      number: mr.iid ?? ref.number,
      title: mr.title ?? '',
      // A locked merge request is still open: the lock only holds its
      // discussions, and the badge must not read Closed for it.
      state:
        mr.state === 'opened' || mr.state === 'locked'
          ? mr.draft === true
            ? 'draft'
            : 'open'
          : mr.state === 'merged'
            ? 'merged'
            : 'closed',
      author: mr.author?.username ?? 'unknown',
      authorAvatarUrl: mr.author?.avatar_url,
      htmlUrl: mr.web_url ?? mergeRequestUrl(ref),
      headRef: mr.source_branch ?? '',
      baseRef: mr.target_branch ?? '',
      createdAt: mr.created_at ?? '',
      updatedAt: mr.updated_at ?? '',
      check,
      body: body != null && body.length > 0 ? body : undefined,
      changedFiles: Number.isFinite(changedFiles) ? changedFiles : undefined,
    };
  },
  comments: {
    async list(ref, cred) {
      ref = gitLabRef(ref);
      const { discussions, users } = clients(ref.host, cred);
      const answer = await call(() =>
        discussions.all(ref.project, ref.number, {
          showExpanded: true,
          perPage: 100,
          maxPages: 10,
        })
      );
      const list = answer.data;

      // A note's author is serialized without the user object's `bot` flag,
      // and a self-hosted instance's busiest commenter is often a custom-named
      // bot the username cannot give away. So each distinct author is read
      // once — in parallel, capped — and the username heuristic answers for
      // whoever is left: an anonymous caller, a failed lookup, or an author
      // past the cap.
      const botByUsername = new Map<string, boolean>();
      if (cred.token != null) {
        const authorIds: number[] = [];
        const seen = new Set<number>();
        for (const discussion of list) {
          for (const note of discussion.notes ?? []) {
            if (note.system === true) continue;
            const id = note.author?.id;
            if (id != null && !seen.has(id)) {
              seen.add(id);
              authorIds.push(id);
              if (authorIds.length >= MAX_ENRICHED_AUTHORS) break;
            }
          }
          if (authorIds.length >= MAX_ENRICHED_AUTHORS) break;
        }
        await Promise.all(
          authorIds.map(async (id) => {
            try {
              const user = await call(() => users.show(id));
              if (user.username != null) {
                botByUsername.set(user.username, user.bot === true);
              }
            } catch {
              // A failed read leaves the author to the heuristic.
            }
          })
        );
      }

      const payloads: CommentPayload[] = [];
      for (const discussion of list) {
        payloads.push(
          ...payloadsFromDiscussion(
            ref,
            discussion,
            (username) =>
              botByUsername.get(username) ?? isGitLabBotLogin(username)
          )
        );
      }
      return payloads;
    },

    async create(ref, input, cred) {
      ref = gitLabRef(ref);
      const { discussions } = clients(ref.host, cred);

      // A reply names the note it answers, and GitLab threads by discussion
      // instead, so the discussion that holds the note is found first — the
      // one lookup keeps a reply on its own thread and nowhere else.
      if (input.replyToId != null) {
        const answer = await call(() =>
          discussions.all(ref.project, ref.number, {
            showExpanded: true,
            perPage: 100,
            maxPages: 10,
          })
        );
        const list = answer.data;
        const thread = list.find((discussion) =>
          (discussion.notes ?? []).some((note) => note.id === input.replyToId)
        );
        if (thread == null) {
          throw new GitHubError(404, m.forge_that_comment_is_no_longer_there());
        }
        // The SDK declares a discussion note's position lines as strings —
        // its write shape; the instance sends numbers, and the payload
        // mapping reads those.
        const note = (await call(() =>
          discussions.addNote(ref.project, ref.number, thread.id, input.body)
        )) as GitLabNote;
        return payloadFromNote(
          ref,
          note,
          thread.notes?.[0]?.id,
          undefined,
          isGitLabBotLogin
        );
      }

      if (input.path == null || input.line == null) {
        throw new GitHubError(
          400,
          m.router_this_comment_is_missing_a_file_or_line()
        );
      }
      const { path, line } = input;

      const position = await diffPosition(ref, cred, { ...input, path, line });

      // The endpoint answers a discussion, and the note it wrote is the
      // first one.
      const discussion = await call(() =>
        discussions.create(ref.project, ref.number, input.body, { position })
      );
      const note = discussion.notes?.[0];
      if (note == null) {
        throw new GitHubError(
          502,
          m.forge_gitlab_answered_without_the_note_it_wrote()
        );
      }
      // The discussion id is the resolve target, reported the way the
      // discussions read reports it: a fresh thread carries its Resolve
      // identity without a reload.
      const payload = payloadFromNote(
        ref,
        note,
        undefined,
        undefined,
        isGitLabBotLogin
      );
      return note.resolvable === true
        ? { ...payload, threadId: discussion.id }
        : payload;
    },

    async remove(ref, commentId, cred) {
      ref = gitLabRef(ref);
      const { notes } = clients(ref.host, cred);
      await call(() => notes.remove(ref.project, ref.number, commentId));
    },

    async resolve(ref, input, cred) {
      ref = gitLabRef(ref);
      // The discussion id is the resolve target. A note that is not
      // resolvable, or a caller without the rights, gets the instance's own
      // sentence back through `call`.
      const { discussions } = clients(ref.host, cred);
      await call(() =>
        discussions.resolve(
          ref.project,
          ref.number,
          input.threadId,
          input.resolved
        )
      );
    },

    async conversation(ref, cred) {
      ref = gitLabRef(ref);
      return readConversation(
        ref.host,
        ref.project,
        ref.number,
        cred,
        mergeRequestUrl(ref)
      );
    },
  },

  issues: {
    create: (target, input, cred) =>
      createGitLabIssue(target as GitLabTarget, input, cred),
  },

  deployments: (target, cred) =>
    readGitLabDeployments(target as GitLabTarget, cred),

  reviews: {
    async team(ref, cred) {
      ref = gitLabRef(ref);
      return readTeamReviews(
        ref.host,
        ref.project,
        ref.number,
        cred,
        mergeRequestUrl(ref)
      );
    },

    async mine(ref, cred) {
      ref = gitLabRef(ref);
      // An approval is the only verdict GitLab keeps, and it belongs to the
      // token's own user, so there is nothing to ask without one.
      if (cred.token == null) return undefined;
      const data = await gql(ref.host, cred, MY_MERGE_REQUEST_APPROVAL_QUERY, {
        path: ref.project,
        iid: String(ref.number),
      });
      const me = data.currentUser?.username;
      if (me == null) return undefined;
      const approved = (
        data.project?.mergeRequest?.approvedBy?.nodes ?? []
      ).some((user) => user?.username === me);
      return approved
        ? { id: 0, state: 'APPROVED', htmlUrl: mergeRequestUrl(ref) }
        : undefined;
    },

    async submit(ref, input, cred) {
      ref = gitLabRef(ref);

      // Staged comments are the instance's own draft notes, so the verdict
      // publishes them: one call for the batch. A failure leaves the drafts
      // in place — they are the staging, so the retry is safe.
      const { draftNotes, notes } = clients(ref.host, cred);
      const trimmed = input.body?.trim();
      // The SDK spells a draft note's position lines as strings, which is
      // its write shape; the instance sends numbers, and the local view
      // reads those.
      const drafts = (await call(() =>
        draftNotes.all(ref.project, ref.number)
      )) as GitLabDraftNote[];
      if (drafts.length > 0) {
        try {
          await call(() => draftNotes.publishBulk(ref.project, ref.number));
        } catch (error) {
          // A draft whose position the instance cannot place fails the whole
          // batch with a bare 500. Name the likely cause and the remedy,
          // because the instance's own message says neither.
          if (error instanceof GitHubError && error.status >= 500) {
            throw new GitHubError(
              502,
              m.forge_gitlab_could_not_publish_the_staged_comments()
            );
          }
          throw error;
        }
      }

      // The approval lands before the summary note: a failed approval
      // retried republishes nothing and re-presses an approval the instance
      // may already have taken, and the summary it would have duplicated
      // never went up.
      if (input.event === 'APPROVE') {
        await approveMergeRequest(ref, cred);
        if (trimmed != null && trimmed.length > 0) {
          await call(() => notes.create(ref.project, ref.number, trimmed));
        }
        return {
          id: 0,
          state: 'APPROVED',
          htmlUrl: mergeRequestUrl(ref),
        };
      }

      // The body goes up as its own note rather than the publish's `note`
      // param, which an instance may ignore — a body that rides only there
      // is a body silently lost.
      if (trimmed != null && trimmed.length > 0) {
        const note = await call(() =>
          notes.create(ref.project, ref.number, trimmed)
        );
        return {
          id: note.id,
          state: 'COMMENTED',
          submittedAt: note.created_at,
          htmlUrl: noteUrl(ref, note.id),
        };
      }

      // COMMENT is the only other verdict GitLab has, and with no drafts and
      // no words it is nothing at all.
      if (drafts.length === 0) {
        throw new GitHubError(400, m.forge_a_comment_needs_words());
      }
      return {
        id: 0,
        state: 'COMMENTED',
        htmlUrl: mergeRequestUrl(ref),
      };
    },
  },

  drafts: {
    async list(ref, cred) {
      ref = gitLabRef(ref);
      // A draft note is visible only to its author, so without a token there
      // is nothing here to ask.
      if (cred.token == null) return [];
      const { draftNotes, users } = clients(ref.host, cred);
      const answer = await call(() =>
        draftNotes.all(ref.project, ref.number, {
          showExpanded: true,
          perPage: 100,
          maxPages: 10,
        })
      );
      // The SDK spells a draft note's position lines as strings, which is
      // its write shape; the instance sends numbers, and the local view
      // reads those.
      const list = answer.data as GitLabDraftNote[];
      if (list.length === 0) return [];
      // A draft's author is always the credential's own user, so one read
      // makes every payload self-contained.
      const me = await call(() => users.showCurrentUser());
      return list.map((draft) =>
        payloadFromDraft(ref, draft, draft, {
          login: me.username,
          avatarUrl: me.avatar_url,
        })
      );
    },

    async create(ref, input, cred) {
      ref = gitLabRef(ref);
      if (input.path == null || input.line == null) {
        throw new GitHubError(
          400,
          m.router_this_comment_is_missing_a_file_or_line()
        );
      }
      const { path, line } = input;
      const { draftNotes, users } = clients(ref.host, cred);
      // The answer carries no author, so the payload is authored the way
      // drafts.list authors its own: the credential's user. That read and the
      // position read answer different questions, so they go together rather
      // than one after the other.
      const [position, me] = await Promise.all([
        diffPosition(ref, cred, { ...input, path, line }),
        call(() => users.showCurrentUser()),
      ]);
      // The draft-note reads' string-lines omission applies to its answer
      // too; and the SDK types a draft note's `line_range` as `number`,
      // which no GitLab request or answer has ever been — the write shape
      // is the discussion one.
      const draft = (await call(() =>
        draftNotes.create(ref.project, ref.number, input.body, {
          position: position as Camelize<MergeRequestDraftNotePositionSchema>,
        })
      )) as GitLabDraftNote;
      // The answer carried no position, so the payload keeps the one it was
      // written with — the cursors' spelling when they stated it, the
      // scalar one otherwise.
      const gitlabPosition = input.gitlabPosition;
      return payloadFromDraft(
        ref,
        draft,
        {
          position:
            gitlabPosition != null
              ? {
                  new_path: gitlabPosition.newPath,
                  old_path: gitlabPosition.oldPath,
                  ...(gitlabPosition.end.kind === 'deletion'
                    ? { old_line: gitlabPosition.end.oldPos }
                    : gitlabPosition.end.kind === 'addition'
                      ? { new_line: gitlabPosition.end.newPos }
                      : {
                          old_line: gitlabPosition.end.oldPos,
                          new_line: gitlabPosition.end.newPos,
                        }),
                }
              : {
                  new_path: path,
                  old_path: path,
                  ...(input.side === 'deletions'
                    ? { old_line: line }
                    : { new_line: line }),
                },
        },
        { login: me.username, avatarUrl: me.avatar_url }
      );
    },

    async remove(ref, input, cred) {
      ref = gitLabRef(ref);
      const { id } = input;
      if (id == null) {
        throw new GitHubError(
          400,
          m.forge_this_staged_comment_names_no_id_to_delete_by()
        );
      }
      const { draftNotes } = clients(ref.host, cred);
      await call(() => draftNotes.remove(ref.project, ref.number, id));
    },
  },
};

/** The merge request's own page on the instance. */
function mergeRequestUrl(ref: PullRef & { forge: 'gitlab' }): string {
  return `https://${ref.host}/${ref.project}/-/merge_requests/${ref.number}`;
}

/** A note's own anchor on that page. */
function noteUrl(ref: PullRef & { forge: 'gitlab' }, noteId: number): string {
  return `${mergeRequestUrl(ref)}#note_${noteId}`;
}

/**
 * A diff note's position: the merge request's own three shas — one read, the
 * way the GitHub side's commit id is one read — plus the line range in
 * GitLab's spelling. `comments.create` and `drafts.create` share it: a draft
 * note takes the same position hash a discussion takes. A caller that holds
 * the parsed diff states the position as raw cursors, which is the only way
 * a renamed file or a context line can be placed exactly; the scalar
 * `path`/`line`/`side` shape stays for everyone else.
 */
async function diffPosition(
  ref: PullRef & { forge: 'gitlab' },
  cred: ForgeCredential,
  input: {
    path: string;
    line: number;
    side?: 'additions' | 'deletions';
    startLine?: number;
    startSide?: 'additions' | 'deletions';
    gitlabPosition?: GitLabPositionInput;
  }
): Promise<DiscussionNotePositionOptions> {
  const { mrs } = clients(ref.host, cred);
  const mr = await call(() => mrs.show(ref.project, ref.number));
  const refs = mr.diff_refs;
  const { base_sha, start_sha, head_sha } = refs ?? {};
  if (base_sha == null || start_sha == null || head_sha == null) {
    throw new GitHubError(
      502,
      m.forge_gitlab_did_not_name_this_merge_requests_diff()
    );
  }
  if (input.gitlabPosition != null) {
    return cursorPosition(
      { base_sha, start_sha, head_sha },
      input.gitlabPosition
    );
  }
  const { path, line } = input;
  const onOldSide = input.side === 'deletions';
  const startsOnOldSide = input.startSide === 'deletions';
  return {
    positionType: 'text',
    baseSha: base_sha,
    startSha: start_sha,
    headSha: head_sha,
    newPath: path,
    oldPath: path,
    ...(onOldSide ? { oldLine: String(line) } : { newLine: String(line) }),
    ...(input.startLine != null && input.startLine !== line
      ? {
          lineRange: {
            start: {
              type: startsOnOldSide ? ('old' as const) : ('new' as const),
              ...(startsOnOldSide
                ? { oldLine: input.startLine }
                : { newLine: input.startLine }),
            },
            end: {
              type: onOldSide ? ('old' as const) : ('new' as const),
              ...(onOldSide ? { oldLine: line } : { newLine: line }),
            },
          },
        }
      : {}),
  };
}

/** A repo-relative path decoded once, the shape GitLab hashes; a malformed escape stands as it is. */
function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** The lowercase hex SHA1 of a path — GitLab's `line_code` prefix. */
async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

/**
 * A diff position from raw cursors, in GitLab's own spelling: `line_code` is
 * the SHA1 of the decoded, repository-relative path — the new one when there
 * is one, the old one otherwise — plus both raw cursors, the one a
 * single-coordinate note hides included. An addition sends only its new
 * coordinate, a deletion only its old one, and a context line both, at the
 * top level and on each `line_range` end alike, and a range's ends carry the
 * `line_code` GitLab requires of them. Missing cursors are never synthesized:
 * a caller that cannot supply them took the scalar path above.
 */
async function cursorPosition(
  refs: { base_sha: string; start_sha: string; head_sha: string },
  position: GitLabPositionInput
): Promise<DiscussionNotePositionOptions> {
  const { end, start } = position;
  const hash = await sha1Hex(
    decodePath(position.newPath) || decodePath(position.oldPath)
  );
  const rangeEnd = (cursor: GitLabPositionCursor, lineCode: string) => ({
    lineCode,
    // The type names the row the way GitLab's own answers do: `new` for an
    // added line, `old` for a removed one, `expanded` for a context line.
    type:
      cursor.kind === 'addition'
        ? ('new' as const)
        : cursor.kind === 'deletion'
          ? ('old' as const)
          : ('expanded' as const),
    ...(cursor.kind === 'deletion'
      ? { oldLine: cursor.oldPos }
      : cursor.kind === 'addition'
        ? { newLine: cursor.newPos }
        : { oldLine: cursor.oldPos, newLine: cursor.newPos }),
  });
  const multiline =
    start != null &&
    (start.oldPos !== end.oldPos ||
      start.newPos !== end.newPos ||
      start.kind !== end.kind);
  return {
    positionType: 'text',
    baseSha: refs.base_sha,
    startSha: refs.start_sha,
    headSha: refs.head_sha,
    newPath: position.newPath,
    oldPath: position.oldPath,
    ...(end.kind === 'deletion'
      ? { oldLine: String(end.oldPos) }
      : end.kind === 'addition'
        ? { newLine: String(end.newPos) }
        : { oldLine: String(end.oldPos), newLine: String(end.newPos) }),
    ...(multiline && start != null
      ? {
          // `expanded` is GitLab's own spelling for a context line; the
          // SDK's write type lists only `new` and `old`.
          lineRange: {
            start: rangeEnd(start, `${hash}_${start.oldPos}_${start.newPos}`),
            end: rangeEnd(end, `${hash}_${end.oldPos}_${end.newPos}`),
          } as Camelize<DiscussionNotePositionTextSchema>['lineRange'],
        }
      : {}),
  };
}

// --- Discussions into payloads ------------------------------------------------------

/** How many distinct authors a comments read enriches before the heuristic answers. */
const MAX_ENRICHED_AUTHORS = 30;

/**
 * A discussion note as the payload mapping reads it. The SDK's
 * `DiscussionNoteSchema` declares neither `position` nor `resolved`, though
 * the instance sends both on a diff note, and it spells the author without
 * the `bot` flag — so the mapping's input is stated here, and the SDK's own
 * schema flows into it.
 */
interface GitLabNote {
  id: number;
  type?: string | null;
  body?: string;
  author?: {
    id?: number;
    username?: string;
    avatar_url?: string;
    bot?: boolean;
  };
  created_at?: string;
  system?: boolean;
  resolvable?: boolean;
  resolved?: boolean;
  position?: {
    new_path?: string;
    old_path?: string;
    new_line?: number;
    old_line?: number;
    line_range?: {
      start?: { new_line?: number; old_line?: number; line_code?: string };
      end?: { new_line?: number; old_line?: number; line_code?: string };
    };
  };
}

interface GitLabDiscussion {
  id: string;
  notes?: GitLabNote[];
}

/** The notes of one discussion, as payloads, root first. */
function payloadsFromDiscussion(
  ref: PullRef & { forge: 'gitlab' },
  discussion: GitLabDiscussion,
  botOf: (username: string) => boolean
): CommentPayload[] {
  const notes = (discussion.notes ?? []).filter((note) => note.system !== true);
  const rootId = notes[0]?.id;
  // Resolution belongs to the thread, so it travels on the root payload
  // alone. Whole-MR notes are not resolvable and report exactly that.
  const resolved =
    notes[0]?.resolvable === true && notes[0]?.resolved === true
      ? true
      : undefined;
  // The discussion id is what the resolve call addresses, so it travels the
  // same way — and only when the instance says the thread takes the mark at
  // all, which is how the card knows not to offer the press.
  const threadId = notes[0]?.resolvable === true ? discussion.id : undefined;
  return notes.map((note, index) => {
    const payload = payloadFromNote(
      ref,
      note,
      index === 0 ? undefined : rootId,
      index === 0 ? resolved : undefined,
      botOf
    );
    return index === 0 && threadId != null ? { ...payload, threadId } : payload;
  });
}

function payloadFromNote(
  ref: PullRef & { forge: 'gitlab' },
  note: GitLabNote,
  replyToId: number | undefined,
  resolved: true | undefined,
  botOf: (username: string) => boolean
): CommentPayload {
  const base = {
    remoteId: note.id,
    author: note.author?.username ?? 'unknown',
    authorAvatarUrl: note.author?.avatar_url,
    // The field when the instance serializes it, the per-author read when it
    // does not, and the username when neither answers.
    authorIsBot: note.author?.bot ?? botOf(note.author?.username ?? ''),
    body: note.body ?? '',
    createdAt: note.created_at,
    htmlUrl: noteUrl(ref, note.id),
    replyToId,
    ...(resolved === true ? { resolved } : {}),
  };

  const position = note.position;
  if (position == null) {
    // A note on the merge request itself: no file, no line, a section of its
    // own in the comments tab.
    return { ...base, path: '', scope: 'merge-request' };
  }

  // The side answers the coordinate that exists, and the line number comes
  // from that same coordinate: a deletion carries only `old_line`, an
  // addition only `new_line`, and a context line both. Reading the side off
  // one coordinate and the number off the other would anchor a shifted
  // context line to a row it never sat on.
  const onOldSide = position.old_line != null;
  // GitLab sends a line_range on plenty of single-line notes: start and end
  // point at the same diff row then — one line_code — and the note is not a
  // range. A genuine range has two; where a line_code is missing, the line
  // numbers answer the same question.
  const start = position.line_range?.start;
  const end = position.line_range?.end;
  const genuineRange =
    start != null &&
    end != null &&
    (start.line_code != null && end.line_code != null
      ? start.line_code !== end.line_code
      : start.new_line !== end.new_line || start.old_line !== end.old_line);
  // The range start pairs the same way; a context start takes the note's own
  // side, and the number from that same side.
  const startSide =
    start?.old_line != null && start.new_line != null
      ? onOldSide
        ? ('deletions' as const)
        : ('additions' as const)
      : start?.old_line != null
        ? ('deletions' as const)
        : ('additions' as const);
  return {
    ...base,
    path: position.new_path ?? position.old_path ?? '',
    line: position.old_line ?? position.new_line ?? 1,
    side: onOldSide ? 'deletions' : 'additions',
    ...(genuineRange
      ? {
          startLine:
            startSide === 'deletions' ? start?.old_line : start?.new_line,
          startSide,
        }
      : {}),
  };
}

/**
 * The merge request's approval configuration, from the all-tiers
 * `approvals` endpoint: `approval_state` exists only on EE, so on a CE
 * instance — the self-hosted deployments — every read of it 404s.
 */
async function approvalConfiguration(
  approvals: MergeRequestApprovals,
  project: string,
  iid: number
): Promise<{ approved_by?: { user?: { username?: string } }[] }> {
  return call(() =>
    approvals.showConfiguration(project, { mergerequestIId: iid })
  );
}

/**
 * Approves the merge request. A repeated approval is a bare 401 from the
 * instance even though the approval stands, so the state is read back and
 * the viewer's presence in it answers for the press — a 401 without them
 * there is the real one, rethrown.
 */
async function approveMergeRequest(
  ref: PullRef & { forge: 'gitlab' },
  cred: ForgeCredential
): Promise<void> {
  const { approvals, users } = clients(ref.host, cred);
  try {
    await call(() => approvals.approve(ref.project, ref.number));
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 401) throw error;
    const me = await call(() => users.showCurrentUser());
    const configuration = await approvalConfiguration(
      approvals,
      ref.project,
      ref.number
    );
    const approved = (configuration.approved_by ?? []).some(
      (entry) => entry.user?.username === me.username
    );
    if (!approved) throw error;
  }
}

// --- Draft notes ---------------------------------------------------------------

/**
 * A draft note as the draft-notes endpoint reports it: the note's text in
 * `note` rather than `body`, no author object (a draft is visible only to its
 * author, who is the credential's own user), and the same position a
 * discussion's note carries. `created_at` is absent from GitLab's own schema,
 * so a payload keeps whatever the instance sends and usually sends nothing.
 */
interface GitLabDraftNote {
  id: number;
  note?: string;
  created_at?: string;
  position?: GitLabNote['position'];
}

/**
 * One draft note as a payload, marked as the draft it is. The position half
 * is `payloadFromNote`'s own: the fields GitLab spells the same way in both
 * shapes are read by the same code. A create answer that arrives without a
 * position falls back to the one it was written with.
 */
function payloadFromDraft(
  ref: PullRef & { forge: 'gitlab' },
  draft: GitLabDraftNote,
  fallback: { position?: GitLabNote['position'] },
  author?: { login?: string; avatarUrl?: string }
): CommentPayload {
  const note: GitLabNote = {
    id: draft.id,
    body: draft.note ?? '',
    created_at: draft.created_at,
    author: { username: author?.login, avatar_url: author?.avatarUrl },
    position: draft.position ?? fallback.position,
  };
  return {
    ...payloadFromNote(ref, note, undefined, undefined, isGitLabBotLogin),
    staged: true,
  };
}
