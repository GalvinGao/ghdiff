import type { AnnotationSide } from '@pierre/diffs';

import { gitHubSideFromAnnotation } from '../comments.ts';
import type { GitHubReviewComment } from './github.ts';
import { readPullCommits, requirePullCommit } from './pullCommits.ts';

export interface PullCommentInput {
  owner: string;
  repo: string;
  number: number;
  body: string;
  replyToId?: number;
  commitSha?: string;
  path?: string;
  line?: number;
  side?: AnnotationSide;
  startLine?: number;
  startSide?: AnnotationSide;
}

export class CommentInputError extends Error {}

/** Replies keep their root's coordinates; new threads pin the selected SHA. */
export async function submitPullComment(
  input: PullCommentInput,
  fetchJson: <T>(path: string) => Promise<T>,
  write: (
    path: string,
    body: Record<string, unknown>
  ) => Promise<GitHubReviewComment | undefined>
) {
  const path = `/repos/${input.owner}/${input.repo}/pulls/${input.number}`;
  if (input.replyToId != null)
    return write(`${path}/comments/${input.replyToId}/replies`, {
      body: input.body,
    });
  if (input.path == null || input.line == null)
    throw new CommentInputError(
      'This comment is missing a file or line number.'
    );
  let commitSha = input.commitSha;
  if (commitSha != null) {
    const commits = await readPullCommits(fetchJson, input);
    try {
      requirePullCommit(commits, commitSha);
    } catch (error) {
      throw new CommentInputError((error as Error).message);
    }
  } else {
    commitSha = (await fetchJson<{ head: { sha: string } }>(path)).head.sha;
  }
  return write(`${path}/comments`, {
    body: input.body,
    commit_id: commitSha,
    path: input.path,
    line: input.line,
    side: gitHubSideFromAnnotation(input.side ?? 'additions'),
    ...(input.startLine != null && input.startLine !== input.line
      ? {
          start_line: input.startLine,
          start_side: gitHubSideFromAnnotation(input.startSide ?? 'additions'),
        }
      : {}),
  });
}
