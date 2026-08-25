// The PR switcher lists open pull requests for the repositories the user
// watches, split into the two review jobs those pull requests represent.
//
//  - 'yours'  — the user opened it, usually because an agent pushed the branch
//               and opened the pull request on their account. Self review.
//  - 'others' — somebody else opened it. Ordinary review.

export interface WatchedRepo {
  owner: string;
  repo: string;
}

export interface PullSummary {
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  authorAvatarUrl?: string;
  draft: boolean;
  htmlUrl: string;
  updatedAt: string;
  headRef: string;
  baseRef: string;
}

export type PullGroupKind = 'yours' | 'others';

export interface PullAuthorGroup {
  author: string;
  authorAvatarUrl?: string;
  pulls: PullSummary[];
}

export interface PullGroup {
  kind: PullGroupKind;
  label: string;
  authors: PullAuthorGroup[];
  count: number;
}

export interface PullSwitcherData {
  viewer?: string;
  groups: PullGroup[];
  /** Repositories that could not be read, with the reason. */
  failures: { repo: string; message: string }[];
}

export function formatWatchedRepo(repo: WatchedRepo): string {
  return `${repo.owner}/${repo.repo}`;
}

export function parseWatchedRepo(input: string): WatchedRepo | undefined {
  const trimmed = input.trim().replace(/^https?:\/\/github\.com\//, '');
  const match = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(
    trimmed
  );
  if (match == null) return undefined;
  return { owner: match[1], repo: match[2] };
}

export function dedupeWatchedRepos(
  repos: readonly WatchedRepo[]
): WatchedRepo[] {
  const seen = new Set<string>();
  const result: WatchedRepo[] = [];
  for (const repo of repos) {
    const key = formatWatchedRepo(repo).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(repo);
  }
  return result;
}

/**
 * Splits pull requests into the two review jobs, then groups the others by
 * author. Newest update first, in both the author list and each author's pulls.
 */
export function groupPulls(
  pulls: readonly PullSummary[],
  viewer: string | undefined
): PullGroup[] {
  const viewerLogin = viewer?.toLowerCase();
  const yours: PullSummary[] = [];
  const others: PullSummary[] = [];

  for (const pull of pulls) {
    if (viewerLogin != null && pull.author.toLowerCase() === viewerLogin) {
      yours.push(pull);
    } else {
      others.push(pull);
    }
  }

  const groups: PullGroup[] = [];
  if (yours.length > 0) {
    groups.push({
      kind: 'yours',
      label: 'Yours',
      authors: [
        {
          author: viewer ?? 'you',
          authorAvatarUrl: yours[0].authorAvatarUrl,
          pulls: sortByUpdated(yours),
        },
      ],
      count: yours.length,
    });
  }
  if (others.length > 0) {
    groups.push({
      kind: 'others',
      label: 'Others',
      authors: groupByAuthor(others),
      count: others.length,
    });
  }
  return groups;
}

function sortByUpdated(pulls: readonly PullSummary[]): PullSummary[] {
  return [...pulls].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function groupByAuthor(pulls: readonly PullSummary[]): PullAuthorGroup[] {
  const byAuthor = new Map<string, PullAuthorGroup>();
  for (const pull of pulls) {
    const existing = byAuthor.get(pull.author);
    if (existing == null) {
      byAuthor.set(pull.author, {
        author: pull.author,
        authorAvatarUrl: pull.authorAvatarUrl,
        pulls: [pull],
      });
    } else {
      existing.pulls.push(pull);
    }
  }

  const groups = [...byAuthor.values()];
  for (const group of groups) {
    group.pulls = sortByUpdated(group.pulls);
  }
  groups.sort((a, b) =>
    b.pulls[0].updatedAt.localeCompare(a.pulls[0].updatedAt)
  );
  return groups;
}
