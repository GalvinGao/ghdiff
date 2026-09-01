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
import { readServedCount } from '@/lib/server/servedCount';
import { isFileViewed } from '@/lib/viewedFiles';

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
 * How many pages of changed files the viewed-mark query reads. GitHub caps a
 * `files` page at 100, so this is a thousand files, and a pull request larger
 * than that gets its first thousand marks and no more. Nothing breaks past the
 * cap: an unread mark draws an empty box, and `viewedFiles.set` addresses a
 * file by its path alone, so a press on file 1001 still reaches GitHub.
 */
const MAX_VIEWED_FILE_PAGES = 10;
const VIEWED_FILES_PAGE_SIZE = 100;

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
    return fail(error, 'Could not verify this token.');
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
              : 'Could not load this repository.',
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
    return fail(error, 'Could not load this pull request.');
  }
});

const getMyReview = os.reviews.mine.handler(async ({ context, input }) => {
  const log = requestLog();
  const { number, owner, repo } = input;
  log.set({ owner, repo, pull: number });
  // GraphQL refuses an anonymous caller, and `viewerLatestReview` is a question
  // about the token in the first place, so there is nothing to ask without one.
  if (context.token == null) return {};

  try {
    const data = await githubGraphQL<MyReviewQueryData>(
      MY_REVIEW_QUERY,
      { owner, repo, number },
      context.token
    );
    const node = data.repository?.pullRequest?.viewerLatestReview;
    // A viewer who has never reviewed this pull request gets a null field and
    // no error, which is the ordinary answer and not a failure. A review whose
    // `databaseId` or `state` did not arrive reads the same way: the header
    // says nothing rather than report a verdict it cannot name.
    if (node?.state == null || typeof node.databaseId !== 'number') {
      log.set({ outcome: 'none' });
      return {};
    }
    log.set({ outcome: 'ok', state: node.state });
    return {
      review: {
        id: node.databaseId,
        state: node.state,
        submittedAt: node.submittedAt ?? undefined,
        htmlUrl: node.url ?? undefined,
      },
    };
  } catch (error) {
    return fail(error, 'Could not load your review of this pull request.');
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
    return fail(error, 'Could not submit this review.');
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
    return fail(error, 'Could not load comments.');
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
        message: 'This comment is missing a file or line number.',
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
    return fail(error, 'Could not post this comment.');
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
    return fail(error, 'Could not delete this comment.');
  }
});

const listViewedFiles = os.viewedFiles.list.handler(
  async ({ context, input }) => {
    const log = requestLog();
    const { number, owner, repo } = input;
    log.set({ owner, repo, pull: number });
    // The mark belongs to the token's own user, and GraphQL refuses an
    // anonymous caller, so there is nothing here to ask without one.
    if (context.token == null) return { paths: [] };

    try {
      const paths: string[] = [];
      let after: string | null = null;
      for (let page = 0; page < MAX_VIEWED_FILE_PAGES; page++) {
        const data: ViewedFilesQueryData = await githubGraphQL(
          VIEWED_FILES_QUERY,
          {
            owner,
            repo,
            number,
            first: VIEWED_FILES_PAGE_SIZE,
            after,
          },
          context.token
        );
        const files = data.repository?.pullRequest?.files;
        if (files == null) break;
        for (const node of files.nodes ?? []) {
          if (node?.path == null) continue;
          if (isFileViewed(node.viewerViewedState)) paths.push(node.path);
        }
        if (files.pageInfo?.hasNextPage !== true) break;
        after = files.pageInfo.endCursor ?? null;
        if (after == null) break;
      }
      log.set({ outcome: 'ok', count: paths.length });
      return { paths };
    } catch (error) {
      return fail(error, 'Could not load which files you have read.');
    }
  }
);

const setViewedFile = os.viewedFiles.set.handler(async ({ context, input }) => {
  const log = requestLog();
  const { number, owner, path, repo, viewed } = input;
  log.set({ owner, repo, pull: number, viewed });
  const token = requireToken(context.token, 'mark a file as viewed');

  try {
    // Both mutations address the pull request by its node id and nothing else,
    // so the id is read first. The browser is not asked to hold it: it would
    // then have to be handed to every press, and a press that arrived before
    // the list did would have nothing to send.
    const found = await githubGraphQL<PullNodeIdQueryData>(
      PULL_NODE_ID_QUERY,
      { owner, repo, number },
      token
    );
    const pullRequestId = found.repository?.pullRequest?.id;
    if (pullRequestId == null) {
      throw new GitHubError(404, 'Not Found');
    }
    await githubGraphQL(
      viewed ? MARK_FILE_VIEWED_MUTATION : UNMARK_FILE_VIEWED_MUTATION,
      { pullRequestId, path },
      token
    );
    log.set({ outcome: 'ok' });
    return { ok: true as const };
  } catch (error) {
    return fail(error, 'Could not send that mark to GitHub.');
  }
});

/**
 * The counter behind the footer's "Served" line. It is the one procedure that
 * asks nothing of GitHub, so it neither reads the token nor reports a GitHub
 * failure: a store that cannot answer throws, the browser catches it, and the
 * footer prints no figure at all.
 */
const getServedCount = os.stats.served.handler(async () => {
  const count = await readServedCount();
  requestLog().set({ outcome: 'ok', served: count });
  return { count };
});

export const router = os.router({
  viewer: { get: getViewer },
  pulls: { list: listPulls, get: getPull },
  stats: { served: getServedCount },
  reviews: {
    mine: getMyReview,
    submit: submitReview,
  },
  comments: {
    list: listComments,
    create: createComment,
    remove: removeComment,
  },
  viewedFiles: {
    list: listViewedFiles,
    set: setViewedFile,
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
//
// `latestOpinionatedReviews` is the review axis itself, and `reviewFromSource`
// says why `reviewDecision` cannot carry it alone. Twenty is the page, because
// a pull request with more than twenty people who each left a verdict is a
// pull request nobody is reading a list of squares for — past that the axis
// misses a twenty-first reviewer's request for changes. `first` is the whole
// page's own cap, so the nesting costs about twenty rate-limit points per
// repository, against the five thousand an hour a token has. The list is
// fetched once a session.
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
        latestOpinionatedReviews(first:20){nodes{state}}
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

// `viewerLatestReview` is the whole question in one field: the last review this
// token's own user left on this pull request. REST has no equivalent — it
// answers with every review by everybody, over as many pages as the pull
// request has collected, and the caller would then have to ask GitHub who it is
// before it could pick out its own.
const MY_REVIEW_QUERY = `
query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$number){
      viewerLatestReview{ databaseId state submittedAt url }
    }
  }
}`;

interface MyReviewQueryData {
  repository?: {
    pullRequest?: {
      viewerLatestReview?: {
        databaseId?: number | null;
        state?: string | null;
        submittedAt?: string | null;
        url?: string | null;
      } | null;
    } | null;
  } | null;
}

// `viewerViewedState` is the whole question in one field: what this token's own
// user has said about this file. REST has no equivalent — the pull request
// files endpoint answers with the patch and the counts and says nothing about
// who has read what — so this and the two mutations under it are GraphQL only.
const VIEWED_FILES_QUERY = `
query($owner:String!,$repo:String!,$number:Int!,$first:Int!,$after:String){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$number){
      files(first:$first,after:$after){
        pageInfo{ hasNextPage endCursor }
        nodes{ path viewerViewedState }
      }
    }
  }
}`;

interface ViewedFilesQueryData {
  repository?: {
    pullRequest?: {
      files?: {
        pageInfo?: {
          hasNextPage?: boolean | null;
          endCursor?: string | null;
        } | null;
        nodes?:
          | ({
              path?: string | null;
              viewerViewedState?: string | null;
            } | null)[]
          | null;
      } | null;
    } | null;
  } | null;
}

const PULL_NODE_ID_QUERY = `
query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$number){ id }
  }
}`;

interface PullNodeIdQueryData {
  repository?: { pullRequest?: { id?: string | null } | null } | null;
}

const MARK_FILE_VIEWED_MUTATION = `
mutation($pullRequestId:ID!,$path:String!){
  markFileAsViewed(input:{pullRequestId:$pullRequestId,path:$path}){ clientMutationId }
}`;

const UNMARK_FILE_VIEWED_MUTATION = `
mutation($pullRequestId:ID!,$path:String!){
  unmarkFileAsViewed(input:{pullRequestId:$pullRequestId,path:$path}){ clientMutationId }
}`;
