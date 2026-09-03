import type { GitHubPullTarget, ReviewTarget } from './reviewTarget.ts';

export interface PullCommit {
  sha: string;
  parents: string[];
  message: string;
  author: string;
  avatarUrl?: string;
  date?: string;
}

export interface PullCommitsData {
  commits: PullCommit[];
  total: number;
  headSha: string;
  truncated: boolean;
}

export interface GitHubCommitSource {
  sha: string;
  parents: { sha: string }[];
  commit: { message: string; author: { name?: string; date?: string } | null };
  author: { login: string; avatar_url?: string } | null;
}

export function toPullCommit(commit: GitHubCommitSource): PullCommit {
  return {
    sha: commit.sha,
    parents: commit.parents.map((parent) => parent.sha),
    message: commit.commit.message,
    author: commit.author?.login ?? commit.commit.author?.name ?? 'unknown',
    avatarUrl: commit.author?.avatar_url,
    date: commit.commit.author?.date,
  };
}

/** An actual parent is an ancestor, so compare's merge base is that parent. */
export function pullCommitDiffTarget(
  pull: GitHubPullTarget,
  commit: PullCommit
): ReviewTarget {
  const ref = { owner: pull.owner, repo: pull.repo };
  const parent = commit.parents[0];
  return parent == null
    ? { kind: 'github-commit', ...ref, sha: commit.sha }
    : { kind: 'github-compare', ...ref, base: parent, head: commit.sha };
}

export function commitNeighbors(commits: readonly PullCommit[], sha?: string) {
  const index = commits.findIndex((commit) => commit.sha === sha);
  return {
    index,
    previous: index > 0 ? commits[index - 1] : undefined,
    next: index >= 0 ? commits[index + 1] : undefined,
  };
}

export function acceptReviewedCommits(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (sha): sha is string =>
              typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha)
          )
        ),
      ]
    : [];
}

export function reviewedCommitCount(
  commits: readonly PullCommit[],
  reviewed: ReadonlySet<string>
): number {
  return commits.filter((commit) => reviewed.has(commit.sha)).length;
}
