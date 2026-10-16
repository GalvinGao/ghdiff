import type { Octokit } from '@octokit/core';

import {
  ADD_REVIEW_MUTATION,
  ADD_REVIEW_THREAD_MUTATION,
  DELETE_REVIEW_COMMENT_MUTATION,
  MARK_FILE_VIEWED_MUTATION,
  MY_REVIEW_QUERY,
  OPEN_PULLS_QUERY,
  PENDING_REVIEW_QUERY,
  PULL_CHECK_QUERY,
  PULL_NODE_ID_QUERY,
  RESOLVE_REVIEW_THREAD_MUTATION,
  REVIEW_THREADS_QUERY,
  TEAM_REVIEWS_QUERY,
  UNMARK_FILE_VIEWED_MUTATION,
  UNRESOLVE_REVIEW_THREAD_MUTATION,
  VIEWED_FILES_QUERY,
  VIEWER_LOGIN_QUERY,
} from './github.gql';
import type {
  OpenPullsQuery,
  ReviewCommentFieldsFragment,
  ReviewThreadFieldsFragment,
  ReviewThreadsQuery,
  TypedDocumentString,
} from './gqlgen/github/graphql';
import { streamMedia } from './media';
import type { Forge, ForgeCredential } from './types';
import { readSignedAttachments } from '@/lib/attachments';
import {
  annotationSideFromGitHub,
  type CommentPayload,
  gitHubSideFromAnnotation,
} from '@/lib/comments';
import type { PullRef } from '@/lib/forges';
import { isGitHubMediaUrl } from '@/lib/github/hosts';
import type { RequestLog } from '@/lib/logger';
import {
  buildConversation,
  type IssueCommentSource,
  type PullReviewSource,
} from '@/lib/pullConversation';
import { toPullDetails, type PullDetails } from '@/lib/pullDetails';
import { formatWatchedRepo, type PullSummary } from '@/lib/pulls';
import { checkStateFromSource, normalizePullStatus } from '@/lib/pullStatus';
import {
  recentTeamReviews,
  type SubmittedReview,
  type TeamReview,
} from '@/lib/reviewDecision';
import type { GitHubTarget } from '@/lib/reviewTarget';
import {
  encodeRefForPath,
  GitHubError,
  githubDiff,
  githubJson,
  githubRaw,
  githubWebDiff,
  githubWebRaw,
  USER_AGENT,
} from '@/lib/server/github/client';
import { readDeployments } from '@/lib/server/github/deployments';
import { createIssue } from '@/lib/server/github/issue';
import { api, gql } from '@/lib/server/github/octokit';
import {
  commitFilesFetch,
  compareFilesFetch,
  describeSynthesisGaps,
  fetchPaged,
  pullFilesFetch,
  synthesizePatch,
} from '@/lib/server/github/patch';
import { conditionalResponse, textResponse } from '@/lib/server/plainText';
import { isFileViewed, type ViewedFilesData } from '@/lib/viewedFiles';
import { m } from '@/paraglide/messages.js';

// The GitHub forge. JSON and GraphQL go through octokit; the two plain-text
// hot paths — a streamed diff and a streamed whole file — stay on the
// hand-rolled fetchers in `../github/client.ts`, because no SDK covers a
// patch that runs to tens of megabytes. The App's own calls (installations,
// the OAuth exchange) are GitHub-only by definition and stay on those
// fetchers too.

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
 * How many of a pull request's newest reviews are read for the dialog's team
 * list. `recentTeamReviews` drops the viewer's own, the bots' and the bare
 * replies GitHub files as reviews, so the page is wider than the five listed.
 */
const TEAM_REVIEWS_PAGE = 50;
/**
 * JSON with every markdown field also rendered as `*_html`. That HTML is the
 * one place GitHub hands out signed addresses for a private body's pictures;
 * `@/lib/attachments` says why.
 */
const FULL_MEDIA = { mediaType: { format: 'full' } } as const;
/** A pull request's review threads come one page at a time, capped like the marks. */
const MAX_COMMENT_PAGES = 10;
const COMMENTS_PAGE_SIZE = 100;

/** The ref as this forge's own, which every procedure needs and the union does not know. */
function gitHubRef(ref: PullRef): Extract<PullRef, { forge: 'github' }> {
  if (ref.forge !== 'github') throw new GitHubError(400, 'Not a GitHub ref.');
  return ref;
}

/**
 * Where a comment body's image is fetched from. What a grant reaches is an
 * attachment on the web host — which answers a browser's own session and a
 * user token as well — and a raw file on the raw host, which takes the same; `isGitHubMediaUrl` holds the allowlist both
 * this gate and the client's share. HTTPS only: the first hop carries the
 * credential, and a plaintext one would hand it to everyone on the path.
 */
function githubMediaUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GitHubError(400, m.forge_that_image_address_is_not_valid());
  }
  if (parsed.protocol !== 'https:') {
    throw new GitHubError(400, m.forge_that_image_address_is_not_valid());
  }
  if (!isGitHubMediaUrl(parsed)) {
    throw new GitHubError(400, m.forge_that_image_is_not_github_hosted());
  }
  return parsed.toString();
}

/** The headers one GitHub media request is sent with: a bearer when there is one. */
function mediaHeaders(cred: ForgeCredential): Record<string, string> {
  const result: Record<string, string> = { 'user-agent': USER_AGENT };
  if (cred.token != null) {
    result.authorization = `Bearer ${cred.token}`;
  }
  return result;
}

export const githubForge: Forge = {
  capabilities: {
    verdicts: ['APPROVE', 'COMMENT', 'REQUEST_CHANGES'],
  },

  diff: (target, cred, log, ifNoneMatch) =>
    gitHubDiffResponse(target as GitHubTarget, cred, log, ifNoneMatch),

  file: (target, path, cred, ifNoneMatch) =>
    gitHubFile(target as GitHubTarget, path, cred.token, ifNoneMatch),

  // Async so a refused address rejects rather than throwing synchronously.
  async media(target, url, cred) {
    return streamMedia(githubMediaUrl(url), cred, mediaHeaders);
  },

  async viewer(cred) {
    if (cred.token == null) return undefined;
    const { data: user } = await api(cred).request('GET /user');
    return { login: user.login, avatarUrl: user.avatar_url, name: user.name };
  },

  async listOpenPulls(repos, cred) {
    const pulls: PullSummary[] = [];
    const failures: { repo: string; message: string }[] = [];

    if (cred.token == null) {
      // Without a token there is no viewer and GraphQL refuses the call, so
      // the read is the REST list it always was — and every author reads as
      // somebody else.
      await Promise.all(
        repos.map(async (ref) => {
          if (ref.forge !== 'github') return;
          try {
            pulls.push(
              ...(await readOpenPullsRest({ owner: ref.owner, repo: ref.repo }))
            );
          } catch (error) {
            failures.push({
              repo: formatWatchedRepo({ owner: ref.owner, repo: ref.repo }),
              message:
                error instanceof GitHubError
                  ? error.message
                  : m.router_could_not_load_this_repository(),
            });
          }
        })
      );
      return { viewer: undefined, pulls, failures };
    }

    // One query per repository, in parallel; each carries the viewer login
    // that decides which pull requests are self review, so the first answer
    // names it for the group.
    const octokit = api(cred);
    let viewer: string | undefined;
    await Promise.all(
      repos.map(async (ref) => {
        if (ref.forge !== 'github') return;
        const repo = { owner: ref.owner, repo: ref.repo };
        try {
          const data = await gql(octokit, OPEN_PULLS_QUERY, {
            owner: ref.owner,
            repo: ref.repo,
            first: MAX_PULLS_PER_REPO,
          });
          viewer ??= data.viewer?.login ?? undefined;
          pulls.push(...pullsFromOpenPulls(repo, data));
        } catch (error) {
          failures.push({
            repo: formatWatchedRepo(repo),
            message:
              error instanceof GitHubError
                ? error.message
                : m.router_could_not_load_this_repository(),
          });
        }
      })
    );

    return { viewer, pulls, failures };
  },

  async pullDetails(ref, cred): Promise<PullDetails> {
    ref = gitHubRef(ref);
    const octokit = api(cred);
    const repo = { owner: ref.owner, repo: ref.repo, number: ref.number };
    const pullRequest = octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      {
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
        ...FULL_MEDIA,
      }
    );
    const [pull, check] = await Promise.all([
      pullRequest.then((response) => response.data),
      // The check axis is GraphQL-only — REST carries no rollup — and GraphQL
      // refuses an anonymous caller, so a tokenless read carries none. A
      // failed read costs the favicon badge, never the details.
      cred.token == null
        ? Promise.resolve(undefined)
        : gql(octokit, PULL_CHECK_QUERY, repo)
            .then((data) =>
              checkStateFromSource(data.repository?.pullRequest ?? {})
            )
            .catch(() => undefined),
    ]);
    return { ...toPullDetails(ref.owner, ref.repo, pull), check };
  },

  comments: {
    async list(ref, cred): Promise<CommentPayload[]> {
      ref = gitHubRef(ref);
      // GraphQL refuses an anonymous caller, so without a token the read is
      // the REST flat list it always was — resolution state and all, or
      // rather without it, since REST's review comments carry none.
      if (cred.token == null) {
        // Full pages until a short one, capped like the marks.
        const octokit = api(cred);
        const comments: ReviewComment[] = [];
        for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
          const chunk = await octokit.request(
            'GET /repos/{owner}/{repo}/pulls/{pull_number}/comments',
            {
              owner: ref.owner,
              repo: ref.repo,
              pull_number: ref.number,
              per_page: COMMENTS_PAGE_SIZE,
              page,
              ...FULL_MEDIA,
            }
          );
          comments.push(...chunk.data);
          if (chunk.data.length < COMMENTS_PAGE_SIZE) break;
        }
        return comments.map(toPayload);
      }
      // With a token the read is `reviewThreads`, which hands each thread
      // over whole — root first, replies nested — with the resolution state
      // the cards collapse on. A thread whose root comment belongs to a
      // review still pending is a draft, not a published comment:
      // `drafts.list` owns those, and listing them here too would draw
      // every staged comment twice. The same goes for a pending reply under
      // a published root — one staged on github.com — which is the
      // review's, not the thread's.
      const threads = await allReviewThreads(api(cred), ref);
      return threads
        .filter((node) => !isPendingThread(node))
        .flatMap(payloadsFromThread)
        .filter((payload) => payload.staged !== true);
    },

    async create(ref, input, cred): Promise<CommentPayload> {
      ref = gitHubRef(ref);
      const octokit = api(cred);
      const { owner, repo, number } = ref;

      // A reply names only the comment it answers. Everything else about where
      // it lands — the path, the line, the side and the commit — comes from
      // that comment, so a reply cannot drift off its thread.
      if (input.replyToId != null) {
        const reply = await octokit.request(
          'POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies',
          {
            owner,
            repo,
            pull_number: number,
            comment_id: input.replyToId,
            body: input.body,
          }
        );
        return toPayload(reply.data);
      }

      if (input.path == null || input.line == null) {
        throw new GitHubError(
          400,
          m.router_this_comment_is_missing_a_file_or_line()
        );
      }
      const { path, line } = input;

      // A review comment must name the commit it applies to.
      const pullRequest = await octokit.request(
        'GET /repos/{owner}/{repo}/pulls/{pull_number}',
        { owner, repo, pull_number: number }
      );

      const created = await octokit.request(
        'POST /repos/{owner}/{repo}/pulls/{pull_number}/comments',
        {
          owner,
          repo,
          pull_number: number,
          body: input.body,
          commit_id: pullRequest.data.head.sha,
          ...gitHubRangeFields({
            path,
            line,
            side: input.side,
            startLine: input.startLine,
            startSide: input.startSide,
          }),
        }
      );
      const createdId = Number(created.data.id);
      // The REST answer names the comment but not its thread, and the
      // thread's node id is what the resolve call addresses. The read that
      // finds it is metadata, not the write: a failure — or a thread past
      // the page cap — leaves the payload without the identity rather than
      // failing a creation that already landed, because the retry that a
      // failure invites would post a second comment. The identity arrives
      // on the next read either way.
      try {
        const thread = await threadForComment(octokit, ref, createdId);
        if (thread != null) {
          const payload = payloadsFromThread(thread).find(
            (candidate) => candidate.remoteId === createdId
          );
          if (payload != null) return payload;
        }
      } catch {
        // The creation stands; the identity arrives on the next read.
      }
      return toPayload(created.data);
    },

    async remove(ref, commentId, cred) {
      ref = gitHubRef(ref);
      await api(cred).request(
        'DELETE /repos/{owner}/{repo}/pulls/comments/{comment_id}',
        { owner: ref.owner, repo: ref.repo, comment_id: commentId }
      );
    },

    async resolve(ref, input, cred) {
      ref = gitHubRef(ref);
      // The mutations address a thread by its GraphQL node id, which the
      // reviewThreads read reports as the root payload's `threadId`.
      if (input.resolved) {
        await gql(api(cred), RESOLVE_REVIEW_THREAD_MUTATION, {
          threadId: input.threadId,
        });
      } else {
        await gql(api(cred), UNRESOLVE_REVIEW_THREAD_MUTATION, {
          threadId: input.threadId,
        });
      }
    },

    async conversation(ref, cred) {
      ref = gitHubRef(ref);
      // GitHub files a remark under the description and a verdict on the pull
      // request in two lists, so both are asked for at once. `full` for the
      // signed attachment addresses, as the comments read asks for it. One
      // page of each, which is the limit the line comments already live with.
      const octokit = api(cred);
      const route = { owner: ref.owner, repo: ref.repo, per_page: 100 };
      const [comments, reviews] = await Promise.all([
        octokit.request(
          'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
          { ...route, issue_number: ref.number, ...FULL_MEDIA }
        ),
        octokit.request(
          'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
          { ...route, pull_number: ref.number, ...FULL_MEDIA }
        ),
      ]);
      return buildConversation(
        comments.data as IssueCommentSource[],
        reviews.data as PullReviewSource[]
      );
    },
  },

  issues: {
    create: (target, input, cred) =>
      createIssue(api(cred), target as GitHubTarget, input),
  },

  deployments: (target, cred) =>
    readDeployments(api(cred), target as GitHubTarget, cred.token != null),

  reviews: {
    async team(ref, cred): Promise<TeamReview[]> {
      ref = gitHubRef(ref);
      const data = await gql(api(cred), TEAM_REVIEWS_QUERY, {
        owner: ref.owner,
        repo: ref.repo,
        number: ref.number,
        last: TEAM_REVIEWS_PAGE,
      });
      return recentTeamReviews(
        data.repository?.pullRequest?.reviews?.nodes ?? []
      );
    },

    async mine(ref, cred): Promise<SubmittedReview | undefined> {
      ref = gitHubRef(ref);
      // GraphQL refuses an anonymous caller, and `viewerLatestReview` is a
      // question about the token in the first place.
      if (cred.token == null) return undefined;
      const data = await gql(api(cred), MY_REVIEW_QUERY, {
        owner: ref.owner,
        repo: ref.repo,
        number: ref.number,
      });
      const node = data.repository?.pullRequest?.viewerLatestReview;
      // A viewer who has never reviewed this pull request gets a null field
      // and no error, which is the ordinary answer and not a failure.
      if (node?.state == null || typeof node.databaseId !== 'number') {
        return undefined;
      }
      return {
        id: node.databaseId,
        state: node.state,
        submittedAt: node.submittedAt ?? undefined,
        htmlUrl: node.url ?? undefined,
      };
    },

    async submit(ref, input, cred): Promise<SubmittedReview> {
      ref = gitHubRef(ref);
      // An empty body is left off rather than sent as `""`. GitHub takes both
      // for an approval, and neither is a body, so the shorter request is the
      // honest one.
      const trimmed = input.body?.trim();
      const body =
        trimmed == null || trimmed.length === 0 ? {} : { body: trimmed };

      // A pending review holds this viewer's staged comments, so the verdict
      // is an event on it — one atomic review, the way github.com's own
      // submit works. With none pending there is nothing to carry, and the
      // verdict is a review of its own.
      const octokit = api(cred);
      const pending = await pendingReview(octokit, ref);
      if (pending != null) {
        const submitted = await octokit.request(
          'POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/events',
          {
            owner: ref.owner,
            repo: ref.repo,
            pull_number: ref.number,
            review_id: pending.databaseId,
            event: input.event,
            ...body,
          }
        );
        return {
          id: Number(submitted.data.id),
          state: submitted.data.state,
          submittedAt: submitted.data.submitted_at ?? undefined,
          htmlUrl: submitted.data.html_url,
        };
      }

      const review = await octokit.request(
        'POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
        {
          owner: ref.owner,
          repo: ref.repo,
          pull_number: ref.number,
          event: input.event,
          ...body,
        }
      );
      return {
        id: Number(review.data.id),
        state: review.data.state,
        submittedAt: review.data.submitted_at ?? undefined,
        htmlUrl: review.data.html_url,
      };
    },
  },

  drafts: {
    async list(ref, cred): Promise<CommentPayload[]> {
      ref = gitHubRef(ref);
      // GraphQL refuses an anonymous caller, and a draft is the token's own,
      // so without one there is nothing here to ask.
      if (cred.token == null) return [];
      const octokit = api(cred);
      // The pending review holds the drafts: every thread whose root comment
      // belongs to it, and every reply that does under a published root — a
      // reply staged on github.com, which the verdict publishes too.
      const pending = await pendingReview(octokit, ref);
      if (pending == null) return [];
      const threads = await allReviewThreads(octokit, ref);
      const drafts: CommentPayload[] = [];
      for (const node of threads) {
        const root = node.comments?.nodes?.find((comment) => comment != null);
        if (root == null) continue;
        if (root.pullRequestReview?.databaseId === pending.databaseId) {
          drafts.push(payloadFromDraft(node, root));
        } else {
          drafts.push(
            ...payloadsFromThread(node).filter((payload) => payload.staged)
          );
        }
      }
      return drafts;
    },

    async create(ref, input, cred): Promise<CommentPayload> {
      ref = gitHubRef(ref);
      // A draft is the token's own pending review; there is no anonymous one.
      if (cred.token == null) {
        throw new GitHubError(401, m.forge_staging_a_comment_needs_a_token());
      }
      if (input.path == null || input.line == null) {
        throw new GitHubError(
          400,
          m.router_this_comment_is_missing_a_file_or_line()
        );
      }
      const { path, line } = input;
      const octokit = api(cred);

      // One pending review per viewer per pull request: the thread joins the
      // one that is there, and starts it when none is.
      let review = await pendingReview(octokit, ref);
      if (review == null) {
        const pullRequestId = await pullRequestNodeId(octokit, ref);
        const started = await gql(octokit, ADD_REVIEW_MUTATION, {
          pullRequestId,
        });
        const id = started.addPullRequestReview?.pullRequestReview?.id;
        const databaseId =
          started.addPullRequestReview?.pullRequestReview?.databaseId;
        if (id == null || databaseId == null) {
          throw new GitHubError(
            502,
            m.forge_github_answered_without_the_review_it_opened()
          );
        }
        review = { id, databaseId };
      }

      const added = await gql(octokit, ADD_REVIEW_THREAD_MUTATION, {
        input: {
          pullRequestReviewId: review.id,
          path,
          body: input.body,
          subjectType: 'LINE',
          line,
          side: gitHubSideFromAnnotation(input.side ?? 'additions'),
          ...(input.startLine != null && input.startLine !== line
            ? {
                startLine: input.startLine,
                startSide: gitHubSideFromAnnotation(
                  input.startSide ?? 'additions'
                ),
              }
            : {}),
        },
      });
      const thread = added.addPullRequestReviewThread?.thread;
      const comment = thread?.comments?.nodes?.[0];
      if (thread == null || comment == null) {
        throw new GitHubError(
          502,
          m.forge_github_answered_without_the_comment_it_wrote()
        );
      }
      return payloadFromDraft(thread, comment);
    },

    async remove(ref, input, cred) {
      ref = gitHubRef(ref);
      if (cred.token == null) {
        throw new GitHubError(
          401,
          m.forge_deleting_a_staged_comment_needs_a_token()
        );
      }
      // The mutation addresses a review comment by its GraphQL node id, which
      // `drafts.list` reports as `remoteNodeId`.
      if (input.nodeId == null) {
        throw new GitHubError(
          400,
          m.forge_this_staged_comment_names_no_node_id_to_delete()
        );
      }
      await gql(api(cred), DELETE_REVIEW_COMMENT_MUTATION, {
        id: input.nodeId,
      });
    },
  },

  viewedFiles: {
    async list(ref, cred): Promise<ViewedFilesData> {
      ref = gitHubRef(ref);
      // The mark belongs to the token's own user, and GraphQL refuses an
      // anonymous caller, so there is nothing here to ask without one.
      if (cred.token == null) return { paths: [] };

      const paths: string[] = [];
      const files = await allConnectionNodes(
        api(cred),
        VIEWED_FILES_QUERY,
        {
          owner: ref.owner,
          repo: ref.repo,
          number: ref.number,
          first: VIEWED_FILES_PAGE_SIZE,
        },
        MAX_VIEWED_FILE_PAGES,
        (data) => data.repository?.pullRequest?.files
      );
      for (const node of files) {
        if (node.path == null) continue;
        if (isFileViewed(node.viewerViewedState)) paths.push(node.path);
      }
      return { paths };
    },

    async set(ref, input, cred) {
      ref = gitHubRef(ref);
      const octokit = api(cred);
      // Both mutations address the pull request by its node id and nothing
      // else, so the id is read first.
      const pullRequestId = await pullRequestNodeId(octokit, ref);
      if (input.viewed) {
        await gql(octokit, MARK_FILE_VIEWED_MUTATION, {
          pullRequestId,
          path: input.path,
        });
      } else {
        await gql(octokit, UNMARK_FILE_VIEWED_MUTATION, {
          pullRequestId,
          path: input.path,
        });
      }
    },
  },
};

// --- The diff cascade ---------------------------------------------------------

function webPath(target: GitHubTarget): string {
  switch (target.kind) {
    case 'github-pull':
      return `/${target.owner}/${target.repo}/pull/${target.number}`;
    case 'github-commit':
      return `/${target.owner}/${target.repo}/commit/${target.sha}`;
    case 'github-compare':
      return `/${target.owner}/${target.repo}/compare/${encodeRefForPath(
        target.base
      )}...${encodeRefForPath(target.head)}`;
  }
}

function apiPath(target: GitHubTarget): string {
  switch (target.kind) {
    case 'github-pull':
      return `/repos/${target.owner}/${target.repo}/pulls/${target.number}`;
    case 'github-commit':
      return `/repos/${target.owner}/${target.repo}/commits/${target.sha}`;
    case 'github-compare':
      return `/repos/${target.owner}/${target.repo}/compare/${encodeRefForPath(
        target.base
      )}...${encodeRefForPath(target.head)}`;
  }
}

function filesFetch(target: GitHubTarget) {
  switch (target.kind) {
    case 'github-pull':
      return pullFilesFetch(target.owner, target.repo, target.number);
    case 'github-commit':
      return commitFilesFetch(target.owner, target.repo, target.sha);
    case 'github-compare':
      return compareFilesFetch(
        target.owner,
        target.repo,
        target.base,
        target.head
      );
  }
}

interface AttemptFailure {
  source: string;
  status: number;
  message: string;
}

/**
 * A target is tried three ways, cheapest and most complete first: the web
 * host's raw `.diff`, which has no file or line cap and streams; the API's
 * diff media type, which accepts a token on every repository but caps a pull
 * request at 300 files and 20000 lines; and the JSON file list stitched back
 * into a patch, which is what survives the 406.
 */
async function gitHubDiffResponse(
  target: GitHubTarget,
  cred: ForgeCredential,
  log: RequestLog,
  ifNoneMatch: string | undefined
): Promise<Response> {
  const token = cred.token;
  log.set({ authenticated: token != null, conditional: ifNoneMatch != null });
  const failures: AttemptFailure[] = [];
  const outcome = (response: Response) =>
    response.status === 304 ? 'unchanged' : 'ok';

  // A browser that kept the patch from last time sends its ETag back. The first
  // two sources pass it to GitHub, and a 304 from either goes back out as a 304
  // with no body. A synthesized patch states no ETag, so the browser never
  // keeps one, and never asks the third source that question.

  // 1. The web host. No file or line cap, and it streams.
  try {
    const response = await githubWebDiff(webPath(target), token, ifNoneMatch);
    log.set({ outcome: outcome(response), source: 'web-diff' });
    return conditionalResponse(response);
  } catch (error) {
    failures.push(describeFailure('web-diff', error));
  }

  // 2. The API's diff media type. Caps a pull request at 300 files and 20000
  //    lines, but it accepts a token on every repository.
  try {
    const response = await githubDiff(apiPath(target), token, ifNoneMatch);
    log.set({ outcome: outcome(response), source: 'api-diff' });
    return conditionalResponse(response);
  } catch (error) {
    failures.push(describeFailure('api-diff', error));
  }

  // 3. The JSON file list, stitched back into a patch. This is the path that
  //    survives the 406 above, at the cost of GitHub's own file-count limit.
  try {
    const fetched = await fetchPaged(
      (path) => githubJson(path, token),
      filesFetch(target)
    );
    const result = synthesizePatch(fetched.files);
    const notice = describeSynthesisGaps(result, fetched.truncated);
    log.set({
      outcome: 'ok',
      source: 'files-api',
      fileCount: result.fileCount,
      filesWithoutPatch: result.filesWithoutPatch.length,
      truncated: fetched.truncated,
    });
    return textResponse(result.patch, { notice });
  } catch (error) {
    failures.push(describeFailure('files-api', error));
  }

  log.set({ outcome: 'error', failures: failures.map((f) => f.source) });
  throw bestFailure(failures);
}

function describeFailure(source: string, error: unknown): AttemptFailure {
  if (error instanceof GitHubError) {
    return { source, status: error.status, message: error.message };
  }
  return {
    source,
    status: 502,
    message:
      error instanceof Error
        ? error.message
        : m.diff_that_request_to_github_failed(),
  };
}

/**
 * Reports the most informative failure. The API speaks in full sentences and
 * knows whether the repository exists, so its message beats the web host's,
 * whose 404 covers both "absent" and "not permitted".
 */
function bestFailure(failures: readonly AttemptFailure[]): GitHubError {
  const fromApi = failures.find((failure) => failure.source === 'api-diff');
  const chosen = fromApi ?? failures[0];
  if (chosen == null) {
    return new GitHubError(502, m.diff_could_not_load_that_diff());
  }
  return new GitHubError(chosen.status, chosen.message);
}

// --- The whole file -----------------------------------------------------------

/**
 * The commit whose copy of a file the patch's new side describes.
 *
 * A pull request answers through `refs/pull/{n}/head`, which GitHub keeps in
 * the base repository and which needs no second request to resolve — and works
 * for a pull request from a fork, where the head commit lives nowhere else this
 * route can reach.
 *
 * A compare range answers with whatever it was addressed by. That is a branch
 * or a sha of this repository for every range ghdiff has a link to, and it is
 * `owner:branch` for a range typed across two forks — which neither source
 * below can read, so such a range gets no unmodified lines and says so.
 */
function newSideRef(target: GitHubTarget): string {
  switch (target.kind) {
    case 'github-pull':
      return `refs/pull/${target.number}/head`;
    case 'github-commit':
      return target.sha;
    case 'github-compare':
      return target.head;
  }
}

/**
 * Where the file comes from turns on the token, and only on the token. A
 * caller with none has sixty REST requests an hour and needs them for the
 * comments and the pull request list, so its file comes from the host behind
 * github.com's own **Raw** links, which costs none of them. A caller with one
 * has five thousand and may be reading a private repository, so its file
 * comes from the contents API, which is the only one of the two that answers
 * for one.
 */
function gitHubFile(
  target: GitHubTarget,
  path: string,
  token: string | undefined,
  ifNoneMatch: string | undefined
): Promise<Response> {
  const ref = newSideRef(target);
  if (token == null) {
    return githubWebRaw(target.owner, target.repo, ref, path, ifNoneMatch);
  }
  return githubRaw(
    `/repos/${target.owner}/${target.repo}/contents/${encodeRefForPath(
      path
    )}?ref=${encodeURIComponent(ref)}`,
    token,
    ifNoneMatch
  );
}

// --- Comment mapping ------------------------------------------------------------

/**
 * A line comment's range in GitHub's spelling: RIGHT for the new side and
 * LEFT for the old, snake_case for the lines, and no start fields for a
 * single line.
 */
function gitHubRangeFields(input: {
  path: string;
  line: number;
  side?: 'additions' | 'deletions';
  startLine?: number;
  startSide?: 'additions' | 'deletions';
}): {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  start_line?: number;
  start_side?: 'LEFT' | 'RIGHT';
} {
  return {
    path: input.path,
    line: input.line,
    side: gitHubSideFromAnnotation(input.side ?? 'additions'),
    ...(input.startLine != null && input.startLine !== input.line
      ? {
          start_line: input.startLine,
          start_side: gitHubSideFromAnnotation(input.startSide ?? 'additions'),
        }
      : {}),
  };
}

/**
 * The review-comment fields the payload mapping reads, in GitHub's REST
 * spelling — `number | bigint` is how the OpenAPI schema types an int64 id.
 * The route calls answer with GitHub's own generated schema, a superset of
 * this; the one shape that needs a name is the anonymous read's accumulator,
 * which gathers pages before any mapping runs.
 */
interface ReviewComment {
  id: number | bigint;
  path: string;
  body: string;
  /** Only sent for the `full` media type, which the comments read asks for. */
  body_html?: string | null;
  line?: number;
  start_line?: number | null;
  original_line?: number;
  original_start_line?: number | null;
  side?: 'LEFT' | 'RIGHT';
  start_side?: 'LEFT' | 'RIGHT' | null;
  created_at: string;
  html_url: string;
  user: {
    login: string;
    avatar_url: string;
    type: string;
  } | null;
  in_reply_to_id?: number;
}

function toPayload(comment: ReviewComment): CommentPayload {
  const side = annotationSideFromGitHub(comment.side ?? 'RIGHT');
  // GitHub reports `line: null` for a comment whose line fell out of the diff
  // after a force push. `original_line` still points at where it was written.
  const line = comment.line ?? comment.original_line ?? 1;
  const startLine = comment.start_line ?? comment.original_start_line;
  return {
    remoteId: Number(comment.id),
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
    ...attachmentsOf(comment.body_html),
  };
}

/**
 * The body's attachments at the addresses GitHub signed, when it signed any —
 * absent rather than empty, so a payload with none carries no field.
 */
function attachmentsOf(html: string | null | undefined) {
  const attachments = readSignedAttachments(html);
  return Object.keys(attachments.byId).length > 0 ? { attachments } : {};
}

// --- GraphQL --------------------------------------------------------------------

/** A thread as the reviewThreads query carries it. */
type ReviewThreadNode = NonNullable<
  NonNullable<
    NonNullable<
      NonNullable<
        NonNullable<ReviewThreadsQuery['repository']>['pullRequest']
      >['reviewThreads']
    >['nodes']
  >[number]
>;

/** A thread comment as the reviewThreads query carries it. */
type ReviewThreadCommentNode = NonNullable<
  NonNullable<NonNullable<ReviewThreadNode['comments']>['nodes']>[number]
>;

/** One page of a GraphQL connection, in the two fields the pager reads. */
interface GraphQLConnection<T> {
  pageInfo?: {
    hasNextPage?: boolean | null;
    endCursor?: string | null;
  } | null;
  nodes?: (T | null)[] | null;
}

/**
 * Every node of one connection, paged until a page says there is no next one
 * — or the cap says stop, the way the marks are capped.
 */
async function allConnectionNodes<
  TData,
  TVars extends Record<string, unknown>,
  TNode,
>(
  octokit: Octokit,
  document: TypedDocumentString<TData, TVars>,
  variables: TVars,
  maxPages: number,
  pick: (data: TData) => GraphQLConnection<TNode> | null | undefined
): Promise<TNode[]> {
  const nodes: TNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const data = await gql(octokit, document, { ...variables, after });
    const connection = pick(data);
    if (connection == null) break;
    for (const node of connection.nodes ?? []) {
      if (node != null) nodes.push(node);
    }
    if (connection.pageInfo?.hasNextPage !== true) break;
    after = connection.pageInfo.endCursor ?? null;
    if (after == null) break;
  }
  return nodes;
}

/** Every review thread of the pull request, paged like the viewed marks. */
function allReviewThreads(
  octokit: Octokit,
  ref: PullRef & { forge: 'github' }
): Promise<ReviewThreadNode[]> {
  return allConnectionNodes(
    octokit,
    REVIEW_THREADS_QUERY,
    {
      owner: ref.owner,
      repo: ref.repo,
      number: ref.number,
      first: COMMENTS_PAGE_SIZE,
    },
    MAX_COMMENT_PAGES,
    (data) => data.repository?.pullRequest?.reviewThreads
  );
}

/**
 * Whether a thread's root comment belongs to a review still pending. Those
 * threads are the viewer's own drafts — GitHub shows a pending review's
 * threads to nobody else — so the published list excludes them and
 * `drafts.list` owns them.
 */
function isPendingThread(node: ReviewThreadNode): boolean {
  const root = node.comments?.nodes?.find((comment) => comment != null);
  return root?.pullRequestReview?.state === 'PENDING';
}

/**
 * The thread one review comment belongs to, paged like the comments read
 * and stopping at the page that holds it. The REST create names the comment
 * but not its thread, and the thread's node id is what the resolve call
 * addresses.
 */
async function threadForComment(
  octokit: Octokit,
  ref: PullRef & { forge: 'github' },
  commentDatabaseId: number
): Promise<ReviewThreadNode | undefined> {
  let after: string | null = null;
  for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
    const data: ReviewThreadsQuery = await gql(octokit, REVIEW_THREADS_QUERY, {
      owner: ref.owner,
      repo: ref.repo,
      number: ref.number,
      first: COMMENTS_PAGE_SIZE,
      after,
    });
    const connection = data.repository?.pullRequest?.reviewThreads;
    for (const node of connection?.nodes ?? []) {
      if (node == null) continue;
      const holds = (node.comments?.nodes ?? []).some(
        (comment) => comment?.databaseId === commentDatabaseId
      );
      if (holds) return node;
    }
    if (connection?.pageInfo?.hasNextPage !== true) break;
    after = connection.pageInfo.endCursor ?? null;
    if (after == null) break;
  }
  return undefined;
}

/**
 * A thread's range on the diff. The position lives on the thread, not on its
 * comments: GitHub's review-comment type carries no `side`, only the thread's
 * `diffSide` answers which side the thread was placed on. `line: null` is a
 * thread whose line fell out of the diff after a force push, and
 * `originalLine` still points at where it was written.
 */
function threadPosition(node: ReviewThreadFieldsFragment) {
  return {
    path: node.path ?? '',
    line: node.line ?? node.originalLine ?? 1,
    startLine: node.startLine ?? node.originalStartLine ?? undefined,
    side: annotationSideFromGitHub(node.diffSide ?? 'RIGHT'),
    startSide:
      node.startDiffSide == null
        ? undefined
        : annotationSideFromGitHub(node.startDiffSide),
  };
}

/**
 * One review thread as payloads, root first. Resolution belongs to the
 * thread, so `resolved` and the thread's node id travel on the root payload
 * alone; a reply points back at the root by its `databaseId`, the id the
 * client's thread grouping already walks.
 */
function payloadsFromThread(node: ReviewThreadNode): CommentPayload[] {
  const comments = (node.comments?.nodes ?? []).filter(
    (comment): comment is ReviewThreadCommentNode => comment != null
  );
  const root = comments[0];
  if (node.id == null || node.path == null || root == null) return [];
  const threadId = node.id;
  const rootId = root.databaseId ?? undefined;
  const position = threadPosition(node);
  return comments.map((comment, index) => ({
    ...commentPayloadFields(comment),
    // A reply still on the viewer's pending review is a draft of theirs,
    // whatever the root is; the published list drops it and the drafts list
    // carries it.
    ...(index > 0 && comment.pullRequestReview?.state === 'PENDING'
      ? { staged: true }
      : {}),
    // GraphQL types an App's account as 'Bot'. The sidebar's People and Bots
    // filter reads this rather than guessing from the login.
    authorIsBot: comment.author?.__typename === 'Bot',
    ...position,
    ...(index === 0
      ? {
          ...(node.isResolved === true ? { resolved: true } : {}),
          threadId,
        }
      : { replyToId: rootId }),
  }));
}

/** The comment fields every thread payload maps the same way, root, reply or draft. */
function commentPayloadFields(comment: ReviewCommentFieldsFragment) {
  return {
    remoteId: comment.databaseId ?? undefined,
    remoteNodeId: comment.id ?? undefined,
    author: comment.author?.login ?? 'unknown',
    authorAvatarUrl: comment.author?.avatarUrl ?? undefined,
    body: comment.body ?? '',
    createdAt: comment.createdAt ?? undefined,
    htmlUrl: comment.url ?? undefined,
    ...attachmentsOf(comment.bodyHTML),
  };
}

/**
 * The list with its review decision and its check rollup, as rows. A token
 * that cannot see the repository gets a 200 with a null repository.
 */
function pullsFromOpenPulls(
  repo: { owner: string; repo: string },
  data: OpenPullsQuery
): PullSummary[] {
  if (data.repository == null) {
    throw new GitHubError(404, m.router_not_found());
  }

  const viewerName = data.viewer?.login?.toLowerCase();
  const pulls: PullSummary[] = [];
  for (const node of data.repository.pullRequests.nodes ?? []) {
    if (node == null) continue;
    // A login matches without case, the way GitHub itself treats one.
    // `some` is the dedupe as well: a duplicated request node answers the
    // same way once.
    const reviewRequested =
      viewerName != null &&
      (node.reviewRequests?.nodes ?? []).some(
        (request) =>
          request?.requestedReviewer != null &&
          'login' in request.requestedReviewer &&
          request.requestedReviewer.login.toLowerCase() === viewerName
      );
    pulls.push({
      owner: repo.owner,
      repo: repo.repo,
      number: node.number,
      title: node.title,
      author: node.author?.login ?? 'unknown',
      authorAvatarUrl: node.author?.avatarUrl ?? undefined,
      // The query asks for open pull requests only, so the lifecycle is either
      // open or draft.
      state: node.isDraft ? 'draft' : 'open',
      htmlUrl: node.url,
      updatedAt: node.updatedAt,
      headRef: node.headRefName,
      baseRef: node.baseRefName,
      status: normalizePullStatus(node),
      reviewRequested: reviewRequested || undefined,
    });
  }
  return pulls;
}

/** The same list without the two status axes, for a reviewer with no token. */
async function readOpenPullsRest(repo: {
  owner: string;
  repo: string;
}): Promise<PullSummary[]> {
  const { data: pulls } = await api({}).request(
    'GET /repos/{owner}/{repo}/pulls',
    {
      owner: repo.owner,
      repo: repo.repo,
      state: 'open',
      sort: 'updated',
      direction: 'desc',
      per_page: MAX_PULLS_PER_REPO,
    }
  );
  return pulls.map((pull) => ({
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

/** The pull request's GraphQL node id, which the mutations address it by. */
async function pullRequestNodeId(
  octokit: Octokit,
  ref: PullRef & { forge: 'github' }
): Promise<string> {
  const found = await gql(octokit, PULL_NODE_ID_QUERY, {
    owner: ref.owner,
    repo: ref.repo,
    number: ref.number,
  });
  const id = found.repository?.pullRequest?.id;
  if (id == null) {
    throw new GitHubError(404, m.router_not_found());
  }
  return id;
}

// --- Review drafts ------------------------------------------------------------

/** The login the token belongs to, which the review queries filter by. */
async function viewerLogin(octokit: Octokit): Promise<string> {
  const data = await gql(octokit, VIEWER_LOGIN_QUERY, {});
  const login = data.viewer?.login;
  if (login == null) {
    throw new GitHubError(502, m.forge_github_did_not_name_the_tokens_user());
  }
  return login;
}

/**
 * The viewer's pending review on this pull request, when there is one. GitHub
 * allows one at a time, and the query asks for that state alone: the reviews
 * connection runs oldest first, so an unfiltered first node is the viewer's
 * oldest review, submitted long ago.
 */
async function pendingReview(
  octokit: Octokit,
  ref: PullRef & { forge: 'github' }
): Promise<{ id: string; databaseId: number } | undefined> {
  const viewer = await viewerLogin(octokit);
  const data = await gql(octokit, PENDING_REVIEW_QUERY, {
    owner: ref.owner,
    repo: ref.repo,
    number: ref.number,
    viewer,
  });
  const node = data.repository?.pullRequest?.reviews?.nodes?.[0];
  if (node?.state !== 'PENDING' || node.id == null || node.databaseId == null) {
    return undefined;
  }
  return { id: node.id, databaseId: node.databaseId };
}

/**
 * A pending review's thread as a payload, marked as the draft it is: the
 * thread's first comment carries the text and the identity, the thread
 * carries the position.
 */
function payloadFromDraft(
  node: ReviewThreadFieldsFragment,
  comment: ReviewCommentFieldsFragment
): CommentPayload {
  return {
    ...commentPayloadFields(comment),
    ...threadPosition(node),
    staged: true,
  };
}
