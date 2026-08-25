// The open pull requests of the watched repositories, and the shape the left
// bar lists them in.
//
// The bar groups them the way a reviewer reads them: which repository, then who
// wrote them, then which stack they belong to. Within one stack the order is the
// stack's own; anywhere else the newest pull request number comes first.

import {
  buildPullStacks,
  countStackNodes,
  type PullStackNode,
} from './pullStacks.ts';
import type { PullReviewStatus } from './pullStatus.ts';

export interface WatchedRepo {
  owner: string;
  repo: string;
}

/**
 * The states GitHub itself distinguishes in its own pull request lists, each
 * with its own octicon and Primer color. `draft` outranks `open`, the way
 * github.com shows it.
 */
export type PullState = 'open' | 'draft' | 'merged' | 'closed';

export interface PullSummary {
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  authorAvatarUrl?: string;
  state: PullState;
  htmlUrl: string;
  updatedAt: string;
  headRef: string;
  baseRef: string;
  /**
   * The review and check axes. Absent when ghdiff read the list without a
   * token: GitHub's REST list carries neither, so the mark stays off the row
   * rather than claim "not reviewed, no checks" about a pull request it never
   * asked about.
   */
  status?: PullReviewStatus;
}

/** Derives the state from the fields GitHub returns for a pull request. */
export function pullState(pull: {
  draft?: boolean;
  merged_at?: string | null;
  state?: string;
}): PullState {
  if (pull.merged_at != null) return 'merged';
  if (pull.state === 'closed') return 'closed';
  if (pull.draft === true) return 'draft';
  return 'open';
}

export interface OpenPullsData {
  viewer?: string;
  pulls: PullSummary[];
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

export interface RepoOwnerGroup {
  owner: string;
  repos: WatchedRepo[];
}

/**
 * The watch list under owner subheadings, so the repository picker can show a
 * bare `repo` on each row and say the owner once above the group.
 */
export function groupReposByOwner(
  repos: readonly WatchedRepo[]
): RepoOwnerGroup[] {
  const byOwner = new Map<string, RepoOwnerGroup>();
  for (const repo of repos) {
    const existing = byOwner.get(repo.owner.toLowerCase());
    if (existing == null) {
      byOwner.set(repo.owner.toLowerCase(), {
        owner: repo.owner,
        repos: [repo],
      });
    } else {
      existing.repos.push(repo);
    }
  }
  const groups = [...byOwner.values()];
  for (const group of groups) {
    group.repos.sort((a, b) => compareText(a.repo, b.repo));
  }
  groups.sort((a, b) => compareText(a.owner, b.owner));
  return groups;
}

export type { PullStackNode };

export interface PullAuthorGroup {
  author: string;
  authorAvatarUrl?: string;
  /** True for the signed-in user, whose own pull requests are self review. */
  isViewer: boolean;
  count: number;
  /** One entry per stack, each a chain of pull requests. */
  stacks: PullStackNode[];
}

export interface PullRepoGroup {
  owner: string;
  repo: string;
  /** `owner/repo`, which is both the React key and the repository filter. */
  key: string;
  count: number;
  authors: PullAuthorGroup[];
}

/**
 * Repository, then author, then stack. Repositories and owners read
 * alphabetically, the viewer's own pull requests lead the authors, and every
 * remaining tie is broken by the newest update.
 */
export function groupPullsByRepo(
  pulls: readonly PullSummary[],
  viewer: string | undefined
): PullRepoGroup[] {
  const viewerLogin = viewer?.toLowerCase();
  const byRepo = new Map<string, PullSummary[]>();
  for (const pull of pulls) {
    const key = formatWatchedRepo(pull).toLowerCase();
    const existing = byRepo.get(key);
    if (existing == null) byRepo.set(key, [pull]);
    else existing.push(pull);
  }

  const groups: PullRepoGroup[] = [];
  for (const repoPulls of byRepo.values()) {
    const first = repoPulls[0];
    groups.push({
      owner: first.owner,
      repo: first.repo,
      key: formatWatchedRepo(first),
      count: repoPulls.length,
      authors: groupByAuthor(repoPulls, viewerLogin),
    });
  }
  groups.sort(
    (a, b) => compareText(a.owner, b.owner) || compareText(a.repo, b.repo)
  );
  return groups;
}

function groupByAuthor(
  pulls: readonly PullSummary[],
  viewerLogin: string | undefined
): PullAuthorGroup[] {
  const byAuthor = new Map<string, PullSummary[]>();
  for (const pull of pulls) {
    const existing = byAuthor.get(pull.author);
    if (existing == null) byAuthor.set(pull.author, [pull]);
    else existing.push(pull);
  }

  const groups: PullAuthorGroup[] = [];
  for (const [author, authorPulls] of byAuthor) {
    groups.push({
      author,
      authorAvatarUrl: authorPulls.find((pull) => pull.authorAvatarUrl != null)
        ?.authorAvatarUrl,
      isViewer: viewerLogin != null && author.toLowerCase() === viewerLogin,
      count: authorPulls.length,
      stacks: buildPullStacks(authorPulls),
    });
  }

  // Self review first. It is the reason this app exists: an agent pushes a
  // branch on the user's account, and that pull request is the one they came to
  // read.
  groups.sort(
    (a, b) =>
      Number(b.isViewer) - Number(a.isViewer) ||
      compareText(latestUpdate(b), latestUpdate(a)) ||
      compareText(a.author, b.author)
  );
  return groups;
}

function latestUpdate(group: PullAuthorGroup): string {
  let latest = '';
  for (const node of flattenStacks(group.stacks)) {
    if (node.pull.updatedAt > latest) latest = node.pull.updatedAt;
  }
  return latest;
}

/** Every node of every stack, in the order the bar draws them. */
export function flattenStacks(
  stacks: readonly PullStackNode[]
): PullStackNode[] {
  const result: PullStackNode[] = [];
  const walk = (nodes: readonly PullStackNode[]) => {
    for (const node of nodes) {
      result.push(node);
      walk(node.children);
    }
  };
  walk(stacks);
  return result;
}

/** How many pull requests one repository group holds. */
export function countRepoPulls(group: PullRepoGroup): number {
  let total = 0;
  for (const author of group.authors) total += countStackNodes(author.stacks);
  return total;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}
