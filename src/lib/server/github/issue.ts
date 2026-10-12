// An issue in the repository under review, made from a note on some of its
// lines.
//
// A permalink that GitHub embeds as a snippet names a commit by its full sha,
// and the browser holds none: a pull request number, a sha as short as the
// address had it, or a branch. So the Worker asks, and the answer turns on the
// side. The new side of all three targets is the head. The old side is the
// commit the diff was taken against — a commit's first parent, and for a pull
// request or a compare range the merge base, since that is what GitHub's own
// three-dot diff runs from. Neither `base.sha` nor the base branch is that
// commit once the base has moved on.

import type { Octokit } from '@octokit/core';
import type { AnnotationSide } from '@pierre/diffs';

import { composeCommentIssue, type CreatedIssue } from '@/lib/commentIssue';
import { blobPermalinkUrl, reviewTargetUrl } from '@/lib/github/urls';
import type { GitHubTarget } from '@/lib/reviewTarget';
import { COMMIT_OID_QUERY } from '@/lib/server/forges/github.gql';
import type { CreateIssueInput } from '@/lib/server/forges/types';
import { GitHubError } from '@/lib/server/github/client';
import { gql } from '@/lib/server/github/octokit';
import { m } from '@/paraglide/messages.js';

async function readCommit(
  octokit: Octokit,
  target: GitHubTarget,
  rev: string
): Promise<{ oid: string; parent?: string }> {
  const data = await gql(octokit, COMMIT_OID_QUERY, {
    owner: target.owner,
    repo: target.repo,
    rev,
  });
  const commit = data.repository?.object;
  if (commit == null || !('oid' in commit)) {
    throw new GitHubError(404, m.issue_missing_commit({ rev }));
  }
  return {
    oid: commit.oid,
    parent: commit.parents.nodes?.[0]?.oid ?? undefined,
  };
}

/**
 * The merge base of a three-dot range. The compare endpoint is the only place
 * GitHub states it, and it answers with the file list besides; this is paid
 * only for a note on removed lines.
 */
async function readMergeBase(
  octokit: Octokit,
  target: GitHubTarget,
  base: string,
  head: string
): Promise<string> {
  const { data } = await octokit.request(
    'GET /repos/{owner}/{repo}/compare/{basehead}',
    {
      owner: target.owner,
      repo: target.repo,
      basehead: `${base}...${head}`,
      per_page: 1,
    }
  );
  const sha = data.merge_base_commit?.sha;
  if (sha == null) throw new GitHubError(404, m.issue_missing_start());
  return sha;
}

/** The full sha the given side of the target's diff was read from. */
export async function resolveSideCommit(
  octokit: Octokit,
  target: GitHubTarget,
  side: AnnotationSide
): Promise<string> {
  switch (target.kind) {
    case 'github-pull': {
      const { data: pull } = await octokit.request(
        'GET /repos/{owner}/{repo}/pulls/{pull_number}',
        { owner: target.owner, repo: target.repo, pull_number: target.number }
      );
      if (side === 'additions') return pull.head.sha;
      return readMergeBase(octokit, target, pull.base.sha, pull.head.sha);
    }
    case 'github-commit': {
      const commit = await readCommit(octokit, target, target.sha);
      if (side === 'additions') return commit.oid;
      if (commit.parent == null) {
        throw new GitHubError(422, m.issue_no_parent());
      }
      return commit.parent;
    }
    case 'github-compare': {
      if (side === 'deletions') {
        return readMergeBase(octokit, target, target.base, target.head);
      }
      // `owner:branch` names a branch in a fork, which `object(expression:)`
      // cannot read in this repository.
      if (target.head.includes(':')) {
        throw new GitHubError(422, m.issue_fork_range());
      }
      return (await readCommit(octokit, target, target.head)).oid;
    }
  }
}

/**
 * Files the note as an issue: the words, a permalink GitHub embeds as a
 * snippet, and the review it came from, which puts a cross-reference on that
 * pull request's timeline.
 */
export async function createIssue(
  octokit: Octokit,
  target: GitHubTarget,
  input: CreateIssueInput
): Promise<CreatedIssue> {
  try {
    const sha = await resolveSideCommit(octokit, target, input.side);
    const { title, body } = composeCommentIssue({
      text: input.text,
      permalink: blobPermalinkUrl(target, sha, input.path, {
        start: input.startLine ?? input.line,
        end: input.line,
      }),
      sourceUrl: reviewTargetUrl(target),
      path: input.path,
      line: input.line,
    });
    const { data: issue } = await octokit.request(
      'POST /repos/{owner}/{repo}/issues',
      { owner: target.owner, repo: target.repo, title, body }
    );
    return { number: issue.number, htmlUrl: issue.html_url };
  } catch (error) {
    // A 403 here is almost always the App's registration or its installation
    // lacking the Issues permission, and GitHub's own sentence for that —
    // "Resource not accessible by integration" — names no permission at all.
    // A spent quota is 429 by now, so it does not land here.
    if (error instanceof GitHubError && error.status === 403) {
      throw new GitHubError(
        403,
        m.router_github_wont_let_ghdiff_open_issues_here_the_ghdiff()
      );
    }
    throw error;
  }
}
