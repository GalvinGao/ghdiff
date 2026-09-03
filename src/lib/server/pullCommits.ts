import {
  type GitHubCommitSource,
  type PullCommitsData,
  toPullCommit,
} from '../pullCommits.ts';
import type { GitHubPullTarget } from '../reviewTarget.ts';

/** Injected fetch keeps pagination and membership independently testable. */
export async function readPullCommits(
  fetchJson: <T>(path: string) => Promise<T>,
  pull: Pick<GitHubPullTarget, 'owner' | 'repo' | 'number'>
): Promise<PullCommitsData> {
  const path = `/repos/${pull.owner}/${pull.repo}/pulls/${pull.number}`;
  const details = await fetchJson<{ commits: number; head: { sha: string } }>(
    path
  );
  const commits: GitHubCommitSource[] = [];
  for (let page = 1; page <= 3; page++) {
    const rows = await fetchJson<GitHubCommitSource[]>(
      `${path}/commits?per_page=100&page=${page}`
    );
    commits.push(...rows);
    if (rows.length < 100) break;
  }
  const unique = [
    ...new Map(
      commits.slice(0, 250).map((commit) => [commit.sha, toPullCommit(commit)])
    ).values(),
  ];
  return {
    commits: unique,
    total: details.commits,
    headSha: details.head.sha,
    truncated: details.commits > unique.length,
  };
}

export function requirePullCommit(data: PullCommitsData, sha: string) {
  const commit = data.commits.find((item) => item.sha === sha);
  if (commit == null)
    throw new Error(
      data.truncated
        ? 'This commit is not in the available list. GitHub lists at most 250 commits per pull request.'
        : 'This commit is no longer in this pull request. Refresh commits or return to All changes.'
    );
  return commit;
}
