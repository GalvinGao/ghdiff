// What reviewer is looking at.
//
// Three of the four targets are a place on GitHub that resolves to one unified
// diff. A pull request is the only one that can carry comments upstream,
// because it is the only one GitHub has a review-comment thread for. A commit
// and a compare range keep their comments in the browser.
//
// The fourth is a diff that is on a developer's own disk and nowhere else, and
// it exists because the `ghdiff` command serves one. The Worker can never
// answer for it — workerd spawns no process and reads no host path — so the
// two `/api` routes turn it away and the command's own server is the only
// thing that answers. Everything above those routes is target-agnostic: the
// viewer, the filter, the fragment grammar and the browser-stored comments all
// read the same shapes they already read for a commit.

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export interface GitHubPullTarget extends GitHubRepoRef {
  kind: 'github-pull';
  number: number;
}

export interface GitHubCommitTarget extends GitHubRepoRef {
  kind: 'github-commit';
  sha: string;
}

export interface GitHubCompareTarget extends GitHubRepoRef {
  kind: 'github-compare';
  base: string;
  head: string;
}

/** Which diff of the repository the `ghdiff` command was asked for. */
export type LocalDiffRange =
  | { mode: 'worktree' }
  | { mode: 'staged' }
  | { mode: 'branch'; base: string }
  | { mode: 'range'; base: string; head: string };

export interface LocalDiffTarget {
  kind: 'local-diff';
  /** Absolute repository root, as the CLI resolved it at launch. */
  root: string;
  range: LocalDiffRange;
}

/**
 * What the two hosted `/api` routes answer a local target with. A reviewer who
 * reaches this pasted an address from a machine that was serving its own diff,
 * so the sentence names the thing that can serve it again.
 */
export const LOCAL_TARGET_NOT_SERVED =
  'That diff is on a machine, not on GitHub. Run the ghdiff command inside that repository to read it.';

/** The three targets github.com has a page for. */
export type GitHubReviewTarget =
  | GitHubPullTarget
  | GitHubCommitTarget
  | GitHubCompareTarget;

export type ReviewTarget = GitHubReviewTarget | LocalDiffTarget;

const OWNER_REPO_PATTERN = /^[A-Za-z0-9._-]+$/;
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/**
 * True when this target is somewhere on github.com, which is what every
 * address, every REST call and the whole account surface is about. The one
 * target that answers false is served by the local command, from a repository
 * GitHub has never been told about.
 */
export function isGitHubTarget(
  target: ReviewTarget
): target is GitHubReviewTarget {
  return target.kind !== 'local-diff';
}

/** The last segment of a repository root, on either platform's separator. */
export function repoNameFromRoot(root: string): string {
  const segments = root.split(/[/\\]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? root;
}

/** What a local range is, in words, for a key and for a label alike. */
function describeLocalRange(range: LocalDiffRange): string {
  switch (range.mode) {
    case 'worktree':
      return 'working tree';
    case 'staged':
      return 'staged';
    case 'branch':
      return `${range.base}...HEAD`;
    case 'range':
      return `${range.base}...${range.head}`;
  }
}

/**
 * True when comments on this target belong to a GitHub review thread. Only a
 * pull request qualifies: GitHub has no comment thread for a bare compare
 * range, and commit comments are a different API with no line ranges.
 */
export function supportsGitHubComments(
  target: ReviewTarget
): target is GitHubPullTarget {
  return target.kind === 'github-pull';
}

/**
 * Stable key for caches and for browser-side comment storage.
 *
 * A local diff keys off the **absolute repository path** and the range, and off
 * nothing the run itself decided: the port is free every time and the token is
 * minted every time, so a key that carried either would lose a reviewer their
 * comments the moment they pressed Ctrl-C.
 */
export function reviewTargetKey(target: ReviewTarget): string {
  switch (target.kind) {
    case 'github-pull':
      return `github:${target.owner}/${target.repo}#${target.number}`;
    case 'github-commit':
      return `github:${target.owner}/${target.repo}@${target.sha}`;
    case 'github-compare':
      return `github:${target.owner}/${target.repo}:${target.base}...${target.head}`;
    case 'local-diff':
      return `local:${target.root}:${describeLocalRange(target.range)}`;
  }
}

/** Short human label for the header. */
export function describeReviewTarget(target: ReviewTarget): string {
  switch (target.kind) {
    case 'github-pull':
      return `${target.owner}/${target.repo} #${target.number}`;
    case 'github-commit':
      return `${target.owner}/${target.repo} @ ${target.sha.slice(0, 7)}`;
    case 'github-compare':
      return `${target.owner}/${target.repo} ${target.base}...${target.head}`;
    case 'local-diff':
      return `${repoNameFromRoot(target.root)} · ${describeLocalRange(
        target.range
      )}`;
  }
}

/**
 * The splat for the `/$` route, which is the whole path. The router
 * percent-encodes each segment on the way out and decodes it on the way back,
 * so this function writes the path plainly and `gitHubTargetFromSegments`
 * reads it back.
 */
export function reviewTargetSplat(target: GitHubReviewTarget): string {
  switch (target.kind) {
    case 'github-pull':
      return `${target.owner}/${target.repo}/pull/${target.number}`;
    case 'github-commit':
      return `${target.owner}/${target.repo}/commit/${target.sha}`;
    case 'github-compare':
      return `${target.owner}/${target.repo}/compare/${target.base}...${target.head}`;
  }
}

/**
 * The path a reviewer would type, for showing rather than for routing. It is
 * `reviewTargetSplat` with a commit SHA cut to seven characters: a row that
 * prints all forty spends its width on a hash nobody reads, and the link under
 * it still carries the whole one.
 */
export function reviewTargetDisplayPath(target: GitHubReviewTarget): string {
  if (target.kind === 'github-commit') {
    return `${target.owner}/${target.repo}/commit/${target.sha.slice(0, 7)}`;
  }
  return reviewTargetSplat(target);
}

/** The query the `/api/diff` route expects for this target. */
export function reviewTargetQuery(target: ReviewTarget): URLSearchParams {
  switch (target.kind) {
    case 'github-pull':
      return new URLSearchParams({
        kind: target.kind,
        owner: target.owner,
        repo: target.repo,
        number: String(target.number),
      });
    case 'github-commit':
      return new URLSearchParams({
        kind: target.kind,
        owner: target.owner,
        repo: target.repo,
        sha: target.sha,
      });
    case 'github-compare':
      return new URLSearchParams({
        kind: target.kind,
        owner: target.owner,
        repo: target.repo,
        base: target.base,
        head: target.head,
      });
    case 'local-diff':
      return new URLSearchParams({
        kind: target.kind,
        root: target.root,
        ...target.range,
      });
  }
}

/** Rebuilds a target from the `/api/diff` query. Returns undefined if invalid. */
export function reviewTargetFromQuery(
  params: URLSearchParams
): ReviewTarget | undefined {
  const kind = params.get('kind');
  if (kind === 'local-diff') return localTargetFromQuery(params);

  const owner = params.get('owner');
  const repo = params.get('repo');
  if (
    owner == null ||
    repo == null ||
    !OWNER_REPO_PATTERN.test(owner) ||
    !OWNER_REPO_PATTERN.test(repo)
  ) {
    return undefined;
  }

  if (kind === 'github-pull') {
    const number = Number(params.get('number'));
    if (!Number.isInteger(number) || number <= 0) return undefined;
    return { kind, owner, repo, number };
  }
  if (kind === 'github-commit') {
    const sha = params.get('sha');
    if (sha == null || !SHA_PATTERN.test(sha)) return undefined;
    return { kind, owner, repo, sha };
  }
  if (kind === 'github-compare') {
    const base = params.get('base');
    const head = params.get('head');
    if (base == null || head == null) return undefined;
    return { kind, owner, repo, base, head };
  }
  return undefined;
}

/**
 * Rebuilds a GitHub target from the route's path segments, which mirror
 * github.com's own paths.
 */
export function gitHubTargetFromSegments(
  segments: readonly string[]
): GitHubReviewTarget | undefined {
  const [owner, repo, kind, ...rest] = segments;
  if (
    owner == null ||
    repo == null ||
    !OWNER_REPO_PATTERN.test(owner) ||
    !OWNER_REPO_PATTERN.test(repo)
  ) {
    return undefined;
  }

  if (kind === 'pull' || kind === 'pulls') {
    const number = Number(rest[0]);
    if (!Number.isInteger(number) || number <= 0) return undefined;
    return { kind: 'github-pull', owner, repo, number };
  }
  if (kind === 'commit' || kind === 'commits') {
    const sha = rest[0];
    if (sha == null || !SHA_PATTERN.test(sha)) return undefined;
    return { kind: 'github-commit', owner, repo, sha };
  }
  if (kind === 'compare') {
    const parsed = parseCompareRange(decodeRange(rest.join('/')));
    if (parsed == null) return undefined;
    return { kind: 'github-compare', owner, repo, ...parsed };
  }
  return undefined;
}

/**
 * The local arm of the query above.
 *
 * The command's own server does not trust a word of this: the repository and
 * the range are pinned when the process starts, and the query is checked
 * against them rather than read. What this parse is for is the client, which
 * rebuilds its own target from the address, and the check that a tab left open
 * from an earlier run is not pointed at a repository this one is not serving.
 */
function localTargetFromQuery(
  params: URLSearchParams
): LocalDiffTarget | undefined {
  const root = params.get('root');
  if (root == null || root.length === 0) return undefined;
  const range = localRangeFromQuery(params);
  if (range == null) return undefined;
  return { kind: 'local-diff', root, range };
}

function localRangeFromQuery(
  params: URLSearchParams
): LocalDiffRange | undefined {
  const mode = params.get('mode');
  const base = params.get('base');
  const head = params.get('head');
  if (mode === 'worktree' || mode === 'staged') return { mode };
  if (mode === 'branch') {
    return base == null || base.length === 0 ? undefined : { mode, base };
  }
  if (mode === 'range') {
    if (base == null || base.length === 0) return undefined;
    if (head == null || head.length === 0) return undefined;
    return { mode, base, head };
  }
  return undefined;
}

/**
 * A compare range reaches this function decoded, because the router decodes the
 * splat. A range typed straight into the address bar does not, so it is decoded
 * here. A literal `%` in a branch name makes `decodeURIComponent` throw, and
 * the raw text is the right answer in that case.
 */
function decodeRange(range: string): string {
  try {
    return decodeURIComponent(range);
  } catch {
    return range;
  }
}

/**
 * Splits `base..head` or `base...head`, the two spellings a range is written
 * in — in a github.com compare path, and in the `ghdiff` command's own
 * argument alike. Both mean the merge-base range here, which is what a branch
 * review is and what github.com's compare page shows.
 */
export function parseCompareRange(
  range: string
): { base: string; head: string } | undefined {
  const separator = range.includes('...') ? '...' : '..';
  const index = range.indexOf(separator);
  if (index <= 0) return undefined;
  const base = range.slice(0, index);
  const head = range.slice(index + separator.length);
  if (base.length === 0 || head.length === 0) return undefined;
  return { base, head };
}

/**
 * Parses whatever the user pasted into the open-a-review box: a github.com
 * URL, or the `owner/repo#123` shorthand.
 */
export function parseGitHubInput(
  input: string
): GitHubReviewTarget | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;

  const shorthand = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)#(\d+)$/.exec(
    trimmed
  );
  if (shorthand != null) {
    return {
      kind: 'github-pull',
      owner: shorthand[1],
      repo: shorthand[2],
      number: Number(shorthand[3]),
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return undefined;
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    return undefined;
  }

  const segments = url.pathname
    .split('/')
    .filter((segment) => segment.length > 0)
    // github.com/o/r/pull/1/files and /commits both point at the same diff.
    .filter(
      (segment, index) =>
        !(index >= 4 && (segment === 'files' || segment === 'changes'))
    );

  // A trailing `.diff` or `.patch` on a pull URL still names the pull.
  const last = segments[segments.length - 1];
  if (last != null && /\.(diff|patch)$/.test(last)) {
    segments[segments.length - 1] = last.replace(/\.(diff|patch)$/, '');
  }

  return gitHubTargetFromSegments(segments);
}
