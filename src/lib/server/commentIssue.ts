// Which commit each side of a diff was read from, as a full sha.
//
// A permalink that GitHub embeds as a snippet names a commit by its full sha,
// and the browser holds none: a pull request number, a sha as short as the
// address had it, or a branch. So the Worker asks, and the answer turns on the
// side. The new side of all three targets is the head. The old side is the
// commit the diff was taken against — a commit's first parent, and for a pull
// request or a compare range the merge base, since that is what GitHub's own
// three-dot diff runs from. Neither `base.sha` nor the base branch is that
// commit once the base has moved on.

import type { AnnotationSide } from '@pierre/diffs';

import type { GitHubRepoRef } from '../reviewTarget.ts';
import {
  encodeRefForPath,
  GitHubError,
  type GitHubPullRequest,
  githubGraphQL,
  githubJson,
} from './github.ts';

export type IssueSource =
  | { kind: 'github-pull'; number: number }
  | { kind: 'github-commit'; sha: string }
  | { kind: 'github-compare'; base: string; head: string };

// `object(expression:)` takes a sha of any length or a branch, and answers with
// the full one and its parent in one request that carries no file list. REST's
// commit endpoint answers the same question with up to 300 patches attached.
const COMMIT_QUERY = `
query($owner:String!,$repo:String!,$rev:String!){
  repository(owner:$owner,name:$repo){
    object(expression:$rev){
      ... on Commit { oid parents(first:1){ nodes{ oid } } }
    }
  }
}`;

interface CommitQueryData {
  repository?: {
    object?: {
      oid?: string | null;
      parents?: { nodes?: ({ oid?: string | null } | null)[] | null } | null;
    } | null;
  } | null;
}

async function readCommit(
  ref: GitHubRepoRef,
  rev: string,
  token: string
): Promise<{ oid: string; parent?: string }> {
  const data = await githubGraphQL<CommitQueryData>(
    COMMIT_QUERY,
    { owner: ref.owner, repo: ref.repo, rev },
    token
  );
  const commit = data.repository?.object;
  if (commit?.oid == null) {
    throw new GitHubError(404, `GitHub has no commit named ${rev} here.`);
  }
  return {
    oid: commit.oid,
    parent: commit.parents?.nodes?.[0]?.oid ?? undefined,
  };
}

/**
 * The merge base of a three-dot range. The compare endpoint is the only place
 * GitHub states it, and it answers with the file list besides; this is paid
 * only for a note on removed lines.
 */
async function readMergeBase(
  ref: GitHubRepoRef,
  base: string,
  head: string,
  token: string
): Promise<string> {
  const compare = await githubJson<{ merge_base_commit?: { sha?: string } }>(
    `/repos/${ref.owner}/${ref.repo}/compare/${encodeRefForPath(
      base
    )}...${encodeRefForPath(head)}`,
    token
  );
  const sha = compare.merge_base_commit?.sha;
  if (sha == null) {
    throw new GitHubError(404, 'GitHub did not say where this range starts.');
  }
  return sha;
}

export async function resolveSideCommit(
  ref: GitHubRepoRef,
  source: IssueSource,
  side: AnnotationSide,
  token: string
): Promise<string> {
  switch (source.kind) {
    case 'github-pull': {
      const pull = await githubJson<GitHubPullRequest>(
        `/repos/${ref.owner}/${ref.repo}/pulls/${source.number}`,
        token
      );
      if (side === 'additions') return pull.head.sha;
      return readMergeBase(ref, pull.base.sha, pull.head.sha, token);
    }
    case 'github-commit': {
      const commit = await readCommit(ref, source.sha, token);
      if (side === 'additions') return commit.oid;
      if (commit.parent == null) {
        throw new GitHubError(
          422,
          'This commit has no parent, so its removed lines have no file to link to.'
        );
      }
      return commit.parent;
    }
    case 'github-compare': {
      if (side === 'deletions') {
        return readMergeBase(ref, source.base, source.head, token);
      }
      // `owner:branch` names a branch in a fork, which `object(expression:)`
      // cannot read in this repository.
      if (source.head.includes(':')) {
        throw new GitHubError(
          422,
          'This range ends in a fork, so an issue here cannot link to its lines.'
        );
      }
      return (await readCommit(ref, source.head, token)).oid;
    }
  }
}
