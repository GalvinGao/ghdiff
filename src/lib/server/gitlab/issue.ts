// An issue in the project under review, made from a note on some of its lines.
//
// The GitLab half of what `../github/issue.ts` does for GitHub, and for the
// same reason: a permalink names a commit by its full sha, and the browser
// holds a merge request number, a short sha or a branch. The new side of all
// three targets is the head. The old side is the commit the diff was taken
// against — a commit's first parent, and for a merge request or a compare
// range the merge base, which is what both diffs run from.

import type { AnnotationSide } from '@pierre/diffs';

import { composeCommentIssue, type CreatedIssue } from '@/lib/commentIssue';
import {
  gitLabBlobPermalinkUrl,
  gitLabReviewTargetUrl,
} from '@/lib/gitlab/urls';
import type { GitLabTarget } from '@/lib/reviewTarget';
import type {
  CreateIssueInput,
  ForgeCredential,
} from '@/lib/server/forges/types';
import { GitHubError } from '@/lib/server/github/client';
import { gitLabJson } from '@/lib/server/gitlab/api';
import { m } from '@/paraglide/messages.js';

function projectPath(target: GitLabTarget): string {
  return `/projects/${encodeURIComponent(target.project)}`;
}

async function readCommit(
  target: GitLabTarget,
  rev: string,
  cred: ForgeCredential
): Promise<{ id: string; parent?: string }> {
  const commit = await gitLabJson<{ id?: string; parent_ids?: string[] }>(
    target.host,
    `${projectPath(target)}/repository/commits/${encodeURIComponent(rev)}`,
    cred
  );
  if (commit.id == null) {
    throw new GitHubError(404, m.issue_gitlab_missing_commit({ rev }));
  }
  return { id: commit.id, parent: commit.parent_ids?.[0] };
}

async function readMergeBase(
  target: GitLabTarget,
  base: string,
  head: string,
  cred: ForgeCredential
): Promise<string> {
  const query = new URLSearchParams([
    ['refs[]', base],
    ['refs[]', head],
  ]);
  const commit = await gitLabJson<{ id?: string }>(
    target.host,
    `${projectPath(target)}/repository/merge_base?${query}`,
    cred
  );
  if (commit.id == null)
    throw new GitHubError(404, m.issue_gitlab_missing_start());
  return commit.id;
}

/** The full sha the given side of the target's diff was read from. */
export async function resolveGitLabSideCommit(
  target: GitLabTarget,
  side: AnnotationSide,
  cred: ForgeCredential
): Promise<string> {
  switch (target.kind) {
    case 'gitlab-mr': {
      const mr = await gitLabJson<{
        diff_refs?: { base_sha?: string; head_sha?: string } | null;
      }>(
        target.host,
        `${projectPath(target)}/merge_requests/${target.number}`,
        cred
      );
      const sha =
        side === 'additions' ? mr.diff_refs?.head_sha : mr.diff_refs?.base_sha;
      if (sha == null)
        throw new GitHubError(404, m.issue_gitlab_missing_start());
      return sha;
    }
    case 'gitlab-commit': {
      const commit = await readCommit(target, target.sha, cred);
      if (side === 'additions') return commit.id;
      if (commit.parent == null) {
        throw new GitHubError(422, m.issue_no_parent());
      }
      return commit.parent;
    }
    case 'gitlab-compare':
      return side === 'deletions'
        ? readMergeBase(target, target.base, target.head, cred)
        : (await readCommit(target, target.head, cred)).id;
  }
}

/**
 * Files the note as an issue: the words, a permalink to the lines at the
 * commit they were read at, and the review it came from. The `see #N` left on
 * the line is a reference GitLab links on its own, in both directions.
 */
export async function createGitLabIssue(
  target: GitLabTarget,
  input: CreateIssueInput,
  cred: ForgeCredential
): Promise<CreatedIssue> {
  const sha = await resolveGitLabSideCommit(target, input.side, cred);
  const { title, body } = composeCommentIssue({
    text: input.text,
    permalink: gitLabBlobPermalinkUrl(target, sha, input.path, {
      start: input.startLine ?? input.line,
      end: input.line,
    }),
    sourceUrl: gitLabReviewTargetUrl(target),
    path: input.path,
    line: input.line,
  });
  const issue = await gitLabJson<{ iid: number; web_url: string }>(
    target.host,
    `${projectPath(target)}/issues`,
    cred,
    { method: 'POST', body: { title, description: body } }
  );
  return { number: issue.iid, htmlUrl: issue.web_url };
}
