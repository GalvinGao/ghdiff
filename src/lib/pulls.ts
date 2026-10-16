// The open pull requests of the watched repositories, and the shape the left
// bar lists them in.
//
// The bar groups them the way a reviewer reads them: which repository, then who
// wrote them, then which stack they belong to. Within one stack the order is the
// stack's own; anywhere else the newest pull request number comes first.

import { forgeGroupKey } from './forges';
import {
  buildPullStacks,
  countStackNodes,
  type PullStackNode,
} from './pullStacks';
import type { PullReviewStatus } from './pullStatus';
import type { GitHubPullTarget } from './reviewTarget';

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
  /**
   * The forge group's own viewer is asked to review this one. Absent when the
   * list was read without a token, for the same reason `status` is: there is
   * no viewer to compare against, and a row must not claim "not requested"
   * about a pull request it never asked about. Team requests on GitHub cannot
   * be resolved to the viewer and never set it.
   */
  reviewRequested?: boolean;
}

/** The review target a row links to. */
export function reviewTargetFromPull(pull: PullSummary): GitHubPullTarget {
  return {
    kind: 'github-pull',
    owner: pull.owner,
    repo: pull.repo,
    number: pull.number,
  };
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

/** One forge group's answer to the open-pulls question. */
export interface OpenPullsData {
  viewer?: string;
  pulls: PullSummary[];
  /** Repositories that could not be read, with the reason. */
  failures: { repo: string; message: string }[];
}

/**
 * The `pulls.list` answer: the groups' pulls and failures, and the viewer of
 * each group that named one, keyed by `forgeGroupKey`. Each group's viewer
 * stays with its own rows.
 */
export interface OpenPullsAnswer {
  viewers: Record<string, string>;
  pulls: PullSummary[];
  /** Repositories that could not be read, with the reason. */
  failures: OpenPullsData['failures'];
}

/** True when any forge group named the reviewer. */
export function anyViewer(viewers: Record<string, string>): boolean {
  return Object.keys(viewers).length > 0;
}

/**
 * The account the setup offer names, out of the rows that would not list.
 * Every failing row sharing one owner names the account; two owners failing
 * is a general question, and `undefined` asks it. `null` is no offer at all:
 * nothing failed, or nobody is signed in.
 */
export function failedSetupAccount(
  failures: readonly { repo: string }[],
  signedIn: boolean
): string | null | undefined {
  if (failures.length === 0 || !signedIn) return null;
  const owners = new Set(failures.map((failure) => failure.repo.split('/')[0]));
  return owners.size === 1 ? [...owners][0] : undefined;
}

/** The label of anything that names a repository: `owner/repo`. */
export function repoLabel(repo: { owner: string; repo: string }): string {
  return `${repo.owner}/${repo.repo}`;
}

export function formatWatchedRepo(repo: WatchedRepo): string {
  return repoLabel(repo);
}

/** What the repository picker accepts: `owner/repo`, or a github.com URL. */
export function parseWatchedRepo(input: string): WatchedRepo | undefined {
  const trimmed = input.trim().replace(/^https?:\/\/github\.com\//, '');
  const match = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(
    trimmed
  );
  if (match == null) return undefined;
  return { owner: match[1], repo: match[2] };
}

/**
 * One repository's identity, for comparing two of them.
 *
 * GitHub treats an owner and a repository name without regard to case, so
 * `Facebook/React` and `facebook/react` are one repository and every reader of
 * a list of them has to agree about that. Stated once, and read by everything
 * that removes, dedupes or looks one up.
 */
export function watchedRepoKey(repo: WatchedRepo): string {
  return formatWatchedRepo(repo).toLowerCase();
}

/** True when the two name the same repository on GitHub. */
export function isSameWatchedRepo(a: WatchedRepo, b: WatchedRepo): boolean {
  return watchedRepoKey(a) === watchedRepoKey(b);
}

export function dedupeWatchedRepos(
  repos: readonly WatchedRepo[]
): WatchedRepo[] {
  const seen = new Set<string>();
  const result: WatchedRepo[] = [];
  for (const repo of repos) {
    const key = watchedRepoKey(repo);
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
  const byOwner = Map.groupBy(repos, (repo) => repo.owner.toLowerCase());
  const groups = [...byOwner.values()].map((group) => ({
    owner: group[0].owner,
    repos: group,
  }));
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

export interface GroupPullsOptions {
  /** The watch list, in the order the reviewer arranged it. */
  order?: readonly WatchedRepo[];
}

/**
 * Repository, then author, then stack. Repositories follow `order`, the watch
 * list the reviewer arranged by hand; one the list does not name goes after it,
 * alphabetically. The viewer's own pull requests lead the authors, what is
 * waiting on the reviewer leads its author group, and every remaining tie is
 * broken by the newest update. A row is the viewer's own only on its own forge
 * group's answer.
 */
export function groupPullsByRepo(
  pulls: readonly PullSummary[],
  viewers: Record<string, string>,
  { order = [] }: GroupPullsOptions = {}
): PullRepoGroup[] {
  const byRepo = Map.groupBy(pulls, (pull) => repoLabel(pull).toLowerCase());

  const groups: PullRepoGroup[] = [];
  for (const repoPulls of byRepo.values()) {
    const first = repoPulls[0];
    groups.push({
      owner: first.owner,
      repo: first.repo,
      key: repoLabel(first),
      count: repoPulls.length,
      authors: groupByAuthor(
        repoPulls,
        viewers[forgeGroupKey(first)]?.toLowerCase()
      ),
    });
  }
  const rank = new Map(
    order.map((repo, index) => [watchedRepoKey(repo), index])
  );
  const rankOf = (group: PullRepoGroup) =>
    rank.get(group.key.toLowerCase()) ?? Number.POSITIVE_INFINITY;
  groups.sort(
    (a, b) =>
      rankOf(a) - rankOf(b) ||
      compareText(a.owner, b.owner) ||
      compareText(a.repo, b.repo)
  );
  return groups;
}

/** True when the signed-in reviewer opened this pull request. */
export function isViewerPull(
  pull: PullSummary,
  viewerLogin: string | undefined
): boolean {
  return viewerLogin != null && pull.author.toLowerCase() === viewerLogin;
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
    const stacks = buildPullStacks(authorPulls);
    // Waiting on the reviewer leads its author group. A stable sort, so the
    // newest-number-first order the stacks were built in holds inside both
    // halves, and a chain bubbles as one block when any member is requested —
    // it is read top to bottom and is never split for this.
    stacks.sort(
      (a, b) =>
        Number(stackHasReviewRequest(b)) - Number(stackHasReviewRequest(a))
    );
    groups.push({
      author,
      authorAvatarUrl: authorPulls.find((pull) => pull.authorAvatarUrl != null)
        ?.authorAvatarUrl,
      isViewer: viewerLogin != null && author.toLowerCase() === viewerLogin,
      count: authorPulls.length,
      stacks,
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

/** True when the reviewer is asked on any pull request of this chain. */
function stackHasReviewRequest(node: PullStackNode): boolean {
  return (
    node.pull.reviewRequested === true ||
    node.children.some(stackHasReviewRequest)
  );
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
