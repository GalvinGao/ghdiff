import { createFileRoute } from '@tanstack/react-router';

import {
  annotationSideFromGitHub,
  type CommentPayload,
  gitHubSideFromAnnotation,
} from '@/lib/comments';
import { requestLog, toLoggable, withEvlog } from '@/lib/logger';
import {
  GitHubError,
  type GitHubPullRequest,
  type GitHubReviewComment,
  githubJson,
  githubWrite,
  readGitHubToken,
} from '@/lib/server/github';

// Review comments for a GitHub pull request. Reviewer keeps no comment store
// of its own: a comment posted here becomes a real pull-request review comment,
// and a comment made on any other target stays in the browser.

interface PullRef {
  owner: string;
  repo: string;
  number: number;
}

function readPullRef(url: URL): PullRef | undefined {
  const owner = url.searchParams.get('owner');
  const repo = url.searchParams.get('repo');
  const number = Number(url.searchParams.get('number'));
  if (
    owner == null ||
    repo == null ||
    !Number.isInteger(number) ||
    number <= 0
  ) {
    return undefined;
  }
  return { owner, repo, number };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function errorResponse(
  error: unknown,
  log: ReturnType<typeof requestLog>
): Response {
  if (error instanceof GitHubError) {
    log.set({ outcome: 'error', status: error.status });
    return json({ error: error.message }, error.status);
  }
  log.error(toLoggable(error), { step: 'comments' });
  return json({ error: 'That comment request failed.' }, 500);
}

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

const listComments = withEvlog(
  async ({ request }: { request: Request }): Promise<Response> => {
    const log = requestLog();
    const pull = readPullRef(new URL(request.url));
    if (pull == null) {
      return json({ error: 'Name a pull request.' }, 400);
    }
    log.set({ owner: pull.owner, repo: pull.repo, pull: pull.number });

    try {
      const token = readGitHubToken(request);
      const comments = await githubJson<GitHubReviewComment[]>(
        `/repos/${pull.owner}/${pull.repo}/pulls/${pull.number}/comments?per_page=100`,
        token
      );
      log.set({ outcome: 'ok', count: comments.length });
      return json({ comments: comments.map(toPayload) });
    } catch (error) {
      return errorResponse(error, log);
    }
  }
);

interface CreateCommentBody {
  body?: unknown;
  path?: unknown;
  line?: unknown;
  side?: unknown;
  startLine?: unknown;
  startSide?: unknown;
  /** The comment this one answers. Its presence makes this a reply. */
  replyToId?: unknown;
}

const createComment = withEvlog(
  async ({ request }: { request: Request }): Promise<Response> => {
    const log = requestLog();
    const pull = readPullRef(new URL(request.url));
    if (pull == null) {
      return json({ error: 'Name a pull request.' }, 400);
    }
    log.set({ owner: pull.owner, repo: pull.repo, pull: pull.number });

    const input = (await request.json().catch(() => undefined)) as
      | CreateCommentBody
      | undefined;
    if (
      input == null ||
      typeof input.body !== 'string' ||
      input.body.trim().length === 0
    ) {
      return json({ error: 'That comment has no body.' }, 400);
    }
    const body = input.body.trim();
    const replyToId =
      typeof input.replyToId === 'number' ? input.replyToId : undefined;
    const path = typeof input.path === 'string' ? input.path : undefined;
    const line = typeof input.line === 'number' ? input.line : undefined;

    try {
      const token = readGitHubToken(request);
      if (token == null) {
        return json({ error: 'Add a GitHub token before you comment.' }, 401);
      }

      // A reply names only the comment it answers. Everything else about where it
      // lands, the path, the line, the side and the commit, comes from that
      // comment, so a reply cannot drift off its thread.
      if (replyToId != null) {
        log.set({ replyToId });
        const reply = await githubWrite<GitHubReviewComment>(
          'POST',
          `/repos/${pull.owner}/${pull.repo}/pulls/${pull.number}/comments/${String(replyToId)}/replies`,
          token,
          { body }
        );
        if (reply == null) {
          return json(
            { error: 'GitHub accepted the reply but returned nothing.' },
            502
          );
        }
        log.set({ outcome: 'replied', commentId: reply.id });
        return json({ comment: toPayload(reply) }, 201);
      }

      if (path == null || line == null) {
        return json(
          { error: 'That comment is missing a path or a line.' },
          400
        );
      }

      // A review comment must name the commit it applies to.
      const pullRequest = await githubJson<GitHubPullRequest>(
        `/repos/${pull.owner}/${pull.repo}/pulls/${pull.number}`,
        token
      );

      const side = input.side === 'deletions' ? 'deletions' : 'additions';
      const created = await githubWrite<GitHubReviewComment>(
        'POST',
        `/repos/${pull.owner}/${pull.repo}/pulls/${pull.number}/comments`,
        token,
        {
          body,
          commit_id: pullRequest.head.sha,
          path,
          line,
          side: gitHubSideFromAnnotation(side),
          ...(typeof input.startLine === 'number' && input.startLine !== line
            ? {
                start_line: input.startLine,
                start_side: gitHubSideFromAnnotation(
                  input.startSide === 'deletions' ? 'deletions' : 'additions'
                ),
              }
            : {}),
        }
      );
      if (created == null) {
        return json(
          { error: 'GitHub accepted the comment but returned nothing.' },
          502
        );
      }
      log.set({ outcome: 'created', commentId: created.id });
      return json({ comment: toPayload(created) }, 201);
    } catch (error) {
      return errorResponse(error, log);
    }
  }
);

const deleteComment = withEvlog(
  async ({ request }: { request: Request }): Promise<Response> => {
    const log = requestLog();
    const url = new URL(request.url);
    const owner = url.searchParams.get('owner');
    const repo = url.searchParams.get('repo');
    const commentId = Number(url.searchParams.get('commentId'));
    if (owner == null || repo == null || !Number.isInteger(commentId)) {
      return json({ error: 'Name the comment to delete.' }, 400);
    }
    log.set({ owner, repo, commentId });

    try {
      const token = readGitHubToken(request);
      if (token == null) {
        return json(
          { error: 'Add a GitHub token before you delete a comment.' },
          401
        );
      }
      await githubWrite(
        'DELETE',
        `/repos/${owner}/${repo}/pulls/comments/${commentId}`,
        token
      );
      log.set({ outcome: 'deleted' });
      return json({ ok: true });
    } catch (error) {
      return errorResponse(error, log);
    }
  }
);

export const Route = createFileRoute('/api/comments')({
  server: {
    handlers: {
      GET: listComments,
      POST: createComment,
      DELETE: deleteComment,
    },
  },
});
