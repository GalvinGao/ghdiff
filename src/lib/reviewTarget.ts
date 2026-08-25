// What reviewer is looking at.
//
// Every target is a place on GitHub that resolves to one unified diff. A pull
// request is the only one that can carry comments upstream, because it is the
// only one GitHub has a review-comment thread for. A commit and a compare range
// keep their comments in the browser.

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

export type ReviewTarget =
  | GitHubPullTarget
  | GitHubCommitTarget
  | GitHubCompareTarget;

const OWNER_REPO_PATTERN = /^[A-Za-z0-9._-]+$/;
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

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

/** Stable key for caches and for browser-side comment storage. */
export function reviewTargetKey(target: ReviewTarget): string {
  switch (target.kind) {
    case 'github-pull':
      return `github:${target.owner}/${target.repo}#${target.number}`;
    case 'github-commit':
      return `github:${target.owner}/${target.repo}@${target.sha}`;
    case 'github-compare':
      return `github:${target.owner}/${target.repo}:${target.base}...${target.head}`;
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
  }
}

/**
 * The splat for the `/$` route, which is the whole path. The router
 * percent-encodes each segment on the way out and decodes it on the way back,
 * so this function writes the path plainly and `gitHubTargetFromSegments`
 * reads it back.
 */
export function reviewTargetSplat(target: ReviewTarget): string {
  switch (target.kind) {
    case 'github-pull':
      return `${target.owner}/${target.repo}/pull/${target.number}`;
    case 'github-commit':
      return `${target.owner}/${target.repo}/commit/${target.sha}`;
    case 'github-compare':
      return `${target.owner}/${target.repo}/compare/${target.base}...${target.head}`;
  }
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
  }
}

/** Rebuilds a target from the `/api/diff` query. Returns undefined if invalid. */
export function reviewTargetFromQuery(
  params: URLSearchParams
): ReviewTarget | undefined {
  const kind = params.get('kind');
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
): ReviewTarget | undefined {
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

function parseCompareRange(
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
export function parseGitHubInput(input: string): ReviewTarget | undefined {
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
