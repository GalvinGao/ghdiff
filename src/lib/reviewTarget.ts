// What reviewer is looking at.
//
// Every target is a place on a git forge that resolves to one unified diff.
// On GitHub that is a pull request, a commit, or a compare range. A pull
// request is the only one that can carry comments upstream, because it is the
// only one GitHub has a review-comment thread for. A commit and a compare range
// keep their comments in the browser.
//
// A target's URL names its host: the canonical path glues it to the first path
// segment with a colon — `/github.com:owner/repo/pull/123`. Hostless paths are
// entry points, never targets: `classifyRouteSegments` sends the loader's
// answer — canonicalize or 404. And a colon host the deployment does not serve
// still parses here: membership is enforced where data is fetched, by the
// server-side forge gate, whose 404 names what this deployment serves.
//
// One target is on no forge at all: a diff on a developer's own disk, which
// exists because the `ghdiff` command serves one. The Worker can never answer
// for it — workerd spawns no process and reads no host path — so the two
// `/api` routes turn it away and the command's own server is the only thing
// that answers. Everything above those routes is target-agnostic: the viewer,
// the filter, the fragment grammar and the browser-stored comments all read
// the same shapes they already read for a commit.

import * as z from 'zod';

import { forgeOfHost } from './forges';
import { GITHUB_HOSTS } from './github/hosts';
import { m } from '@/paraglide/messages.js';

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
  | { mode: 'range'; base: string; head: string }
  /**
   * One commit's own changes. `rev` is the full sha by the time a target is
   * built: `HEAD` is what the developer typed, and it names a different commit
   * the moment they make another, so the command resolves it at launch and
   * the key below holds the commit and not the pointer.
   */
  | { mode: 'commit'; rev: string };

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
export const LOCAL_TARGET_NOT_SERVED = m.local_diff_remote;

/** The targets a forge answers for: every one but the local diff. */
export type ForgeTarget =
  | GitHubPullTarget
  | GitHubCommitTarget
  | GitHubCompareTarget;

export type ReviewTarget = ForgeTarget | LocalDiffTarget;

/** The targets GitHub answers for. */
export type GitHubTarget = ForgeTarget;

const OWNER_REPO_PATTERN = /^[A-Za-z0-9._-]+$/;
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/**
 * True when this target is somewhere on a forge, which is what every address,
 * every forge call and the whole account surface is about. The one target that
 * answers false is served by the local command, from a repository no forge has
 * ever been told about.
 */
export function isForgeTarget(target: ReviewTarget): target is ForgeTarget {
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
      return m.local_working_tree();
    case 'staged':
      return 'staged';
    case 'branch':
      return `${range.base}...HEAD`;
    case 'range':
      return `${range.base}...${range.head}`;
    case 'commit':
      return `commit ${range.rev}`;
  }
}

/**
 * A revision as a header prints it: a sha is cut to the seven characters a
 * developer reads it by, and a name that is not a sha is left as it was.
 */
function labelRevision(rev: string): string {
  return SHA_PATTERN.test(rev) ? rev.slice(0, 7) : rev;
}

/** `describeLocalRange` for a header, with every sha in it cut short. */
function labelLocalRange(range: LocalDiffRange): string {
  switch (range.mode) {
    case 'worktree':
    case 'staged':
      return describeLocalRange(range);
    case 'branch':
      return `${labelRevision(range.base)}...HEAD`;
    case 'range':
      return `${labelRevision(range.base)}...${labelRevision(range.head)}`;
    case 'commit':
      return `commit ${labelRevision(range.rev)}`;
  }
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
      return `${target.owner}/${target.repo} ${labelRevision(
        target.base
      )}...${labelRevision(target.head)}`;
    case 'local-diff':
      return `${repoNameFromRoot(target.root)} · ${labelLocalRange(
        target.range
      )}`;
  }
}

/** The kind of diff a target is, for the favicon's type badge. */
export type ReviewTabType = 'pull' | 'commit' | 'compare';

/** Which badge the favicon paints for this target. */
export function reviewTabType(target: ReviewTarget): ReviewTabType {
  switch (target.kind) {
    case 'github-pull':
      return 'pull';
    case 'github-commit':
      return 'commit';
    case 'github-compare':
      return 'compare';
    case 'local-diff':
      return target.range.mode === 'commit' ? 'commit' : 'compare';
  }
}

/**
 * The browser tab's title for a review, in the forges' own habit of naming
 * the change and where it lives: the pull request's title when it has been
 * read, then the host and the path with the forge's own `#` marker, then the
 * app's name — a ghdiff tab reads as a
 * ghdiff tab next to the forge's own.
 */
export function reviewTabTitle(
  target: ReviewTarget,
  pullTitle?: string
): string {
  const brand = 'ghdiff';
  switch (target.kind) {
    case 'github-pull': {
      const place = `${GITHUB_HOSTS[0]}/${target.owner}/${target.repo} #${target.number}`;
      return pullTitle == null
        ? `${place} · ${brand}`
        : `${pullTitle} · ${place} · ${brand}`;
    }
    case 'github-commit':
      return `${GITHUB_HOSTS[0]}/${target.owner}/${target.repo} @ ${target.sha.slice(0, 7)} · ${brand}`;
    case 'github-compare':
      return `${GITHUB_HOSTS[0]}/${target.owner}/${target.repo} ${target.base}...${target.head} · ${brand}`;
    case 'local-diff':
      return `${describeReviewTarget(target)} · ${brand}`;
  }
}

/**
 * The splat for the `/$` route, which is the whole path, in the canonical
 * form: the host glued to the first segment with a colon. The router
 * percent-encodes each segment on the way out and decodes it on the way back
 * — with `:` kept literal, because the router names it in
 * `pathParamsAllowedCharacters` — so this function writes the path plainly
 * and `reviewTargetFromSegments` reads it back.
 */
export function reviewTargetSplat(target: ForgeTarget): string {
  switch (target.kind) {
    case 'github-pull':
      return `${GITHUB_HOSTS[0]}:${target.owner}/${target.repo}/pull/${target.number}`;
    case 'github-commit':
      return `${GITHUB_HOSTS[0]}:${target.owner}/${target.repo}/commit/${target.sha}`;
    case 'github-compare':
      return `${GITHUB_HOSTS[0]}:${target.owner}/${target.repo}/compare/${target.base}...${target.head}`;
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
    case 'local-diff':
      return new URLSearchParams({
        kind: target.kind,
        root: target.root,
        ...target.range,
      });
  }
}

const ownerRepoSchema = z.string().regex(OWNER_REPO_PATTERN);
const shaSchema = z.string().regex(SHA_PATTERN);
const numberSchema = z.coerce.number().int().positive();

/**
 * The `/api/diff` family's query string as a zod schema: the raw search
 * params in, the parsed target out — structurally the `ReviewTarget` union.
 * Unknown keys strip. `base`/`head` are required but may be empty, the same
 * tolerance the old parser had.
 */
export const reviewTargetSearch = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('github-pull'),
    owner: ownerRepoSchema,
    repo: ownerRepoSchema,
    number: numberSchema,
  }),
  z.object({
    kind: z.literal('github-commit'),
    owner: ownerRepoSchema,
    repo: ownerRepoSchema,
    sha: shaSchema,
  }),
  z.object({
    kind: z.literal('github-compare'),
    owner: ownerRepoSchema,
    repo: ownerRepoSchema,
    base: z.string(),
    head: z.string(),
  }),
]);

/**
 * The hosted `/api` routes' query: a forge target, or a local one, which they
 * recognize only to turn away with `LOCAL_TARGET_NOT_SERVED` — it reaches them
 * only from a link pasted out of a local run, and the sentence that names the
 * command is worth more than "not valid".
 */
export const hostedTargetSearch = z.discriminatedUnion('kind', [
  ...reviewTargetSearch.options,
  z.object({ kind: z.literal('local-diff') }),
]);

/**
 * Rebuilds a target from the query `reviewTargetQuery` wrote: a forge target
 * through the same schema the routes validate with, and a local one by hand.
 * The command's own server reads it this way, and so does the client that
 * rebuilds its own target from the address.
 */
export function reviewTargetFromQuery(
  params: URLSearchParams
): ReviewTarget | undefined {
  if (params.get('kind') === 'local-diff') return localTargetFromQuery(params);
  return reviewTargetSearch.safeParse(Object.fromEntries(params)).data;
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
  const rev = params.get('rev');
  if (mode === 'worktree' || mode === 'staged') return { mode };
  if (mode === 'commit') {
    return rev == null || rev.length === 0 ? undefined : { mode, rev };
  }
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
 * The canonical glue, split: `host:first-path-segment`. The port-safe order
 * matters — `git.example:8443:owner` is host `git.example:8443` with first
 * segment `owner`, while `git.example:8443` alone is a host with a port and no
 * path at all: an all-digits right side of a single colon is the port, so that
 * segment is not the colon form. The host lowercases, the way a URL's hostname
 * does.
 */
const HOST_PORT_COLON_PATTERN = /^([a-z0-9.-]+:\d+):(.+)$/i;
const HOST_COLON_PATTERN = /^([a-z0-9.-]+):(.+)$/i;

export function splitColonHost(
  segment: string
): { host: string; first: string } | undefined {
  const withPort = HOST_PORT_COLON_PATTERN.exec(segment);
  if (withPort != null) {
    return { host: withPort[1].toLowerCase(), first: withPort[2] };
  }
  const plain = HOST_COLON_PATTERN.exec(segment);
  if (plain != null && !/^\d+$/.test(plain[2])) {
    return { host: plain[1].toLowerCase(), first: plain[2] };
  }
  return undefined;
}

/**
 * The one shape a review path can have, read in a single match: GitHub's
 * `owner/repo/page/…`, with every parameter captured by name — the review
 * number, the commit sha, the compare range's base and head. The host is not
 * read here: it arrives glued with a colon (splitColonHost), from a URL's
 * hostname, or not at all — and which grammar it speaks is `forgeOfHost`'s
 * answer, not this pattern's. Nobody matches against the pattern directly;
 * `pathShapeOf` is the typed way in.
 */
const PATH_SHAPE =
  /^(?<owner>[\w.-]+)\/(?<repo>[\w.-]+)\/(?:(?<githubPull>pulls?\/(?<pullNumber>[1-9]\d*))|(?<githubCommit>commits?\/(?<githubSha>[0-9a-fA-F]{7,40}))|(?<githubCompare>compare\/(?<githubBase>.+?)\.\.\.?(?<githubHead>.+)))(?:\/.*)?$/;

/** The page a review path names, with its parameters read. */
export type PathPage =
  | { kind: 'pull'; number: number }
  | { kind: 'commit'; sha: string }
  | { kind: 'compare'; base: string; head: string };

/**
 * What a review path says it is: the GitHub shape with its owner and repo,
 * and the page's parameters already read. Undefined when the path is no
 * review's shape.
 */
export type PathShape = {
  forge: 'github';
  owner: string;
  repo: string;
  page: PathPage;
};

/** What a review path says it is, or undefined when it is no review's shape. */
export function pathShapeOf(path: string): PathShape | undefined {
  const g = PATH_SHAPE.exec(path)?.groups ?? {};
  if (g.owner != null && g.repo != null) {
    const page = gitHubPage(g);
    return page == null
      ? undefined
      : { forge: 'github', owner: g.owner, repo: g.repo, page };
  }
  return undefined;
}

function gitHubPage(g: Record<string, string>): PathPage | undefined {
  if (g.githubPull != null) {
    return { kind: 'pull', number: Number(g.pullNumber) };
  }
  if (g.githubCommit != null) return { kind: 'commit', sha: g.githubSha };
  if (g.githubCompare != null) {
    return {
      kind: 'compare',
      base: decodeRange(g.githubBase),
      head: decodeRange(g.githubHead),
    };
  }
  return undefined;
}

/**
 * The target a path's shape stands for on a host — the two must agree: a
 * GitHub page belongs to a GitHub-speaking host, or to no host at all, the
 * hostless form the route canonicalizes. Anything else is no target.
 */
export function targetFromPathShape(
  shape: PathShape,
  host: string | undefined
): ForgeTarget | undefined {
  if (host != null && forgeOfHost(host) !== 'github') return undefined;
  switch (shape.page.kind) {
    case 'pull':
      return {
        kind: 'github-pull',
        owner: shape.owner,
        repo: shape.repo,
        number: shape.page.number,
      };
    case 'commit':
      return {
        kind: 'github-commit',
        owner: shape.owner,
        repo: shape.repo,
        sha: shape.page.sha,
      };
    case 'compare':
      return {
        kind: 'github-compare',
        owner: shape.owner,
        repo: shape.repo,
        base: shape.page.base,
        head: shape.page.head,
      };
  }
}

/**
 * The path segments of an input a reviewer typed, or of a `from` path the
 * setup page reads: trimmed, a scheme and a leading slash stripped, split on
 * `/` with the empties gone.
 */
export function segmentsFromPath(input: string): string[] {
  return input
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^\//, '')
    .split('/')
    .filter((segment) => segment.length > 0);
}

/**
 * Rebuilds a target from the route's path segments, in the canonical colon
 * form alone: the first segment carries the host glued on with a colon, and
 * the rest reads `owner/repo/pull/123` the way github.com does. A host that
 * speaks no forge's grammar is no target.
 */
export function reviewTargetFromSegments(
  segments: readonly string[]
): ForgeTarget | undefined {
  const first = segments[0];
  if (first == null) return undefined;
  const split = splitColonHost(first);
  if (split == null) return undefined;
  const shape = pathShapeOf([split.first, ...segments.slice(1)].join('/'));
  return shape == null ? undefined : targetFromPathShape(shape, split.host);
}

/**
 * Splits `base..head` or `base...head`, the two spellings a range is written
 * in — in a forge's compare path, and in the `ghdiff` command's own argument
 * alike. Both mean the merge-base range here, which is what a branch review is
 * and what a forge's compare page shows.
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

/** What the `/$` loader does with a path, before any target exists. */
export type RouteParse =
  | { kind: 'target'; target: ForgeTarget }
  | { kind: 'redirect'; splat: string; status: 302 }
  | { kind: 'none' };

/**
 * Classifies the route's path segments for the `/$` loader. Pure and
 * client-safe — no config, no network: whether this deployment serves GitHub
 * is the server-side forge gate's to answer, so a colon target is a target
 * here and may be a 404 there.
 *
 * - The canonical colon form parses to a target, or to nothing when the rest
 *   of the path holds no grammar.
 * - A hostless GitHub-shaped path redirects to the one GitHub host.
 */
export function classifyRouteSegments(segments: readonly string[]): RouteParse {
  const first = segments[0];
  if (first == null) return { kind: 'none' };
  const splat = segments.join('/');

  const split = splitColonHost(first);
  if (split != null) {
    const shape = pathShapeOf([split.first, ...segments.slice(1)].join('/'));
    const target =
      shape == null ? undefined : targetFromPathShape(shape, split.host);
    return target == null ? { kind: 'none' } : { kind: 'target', target };
  }

  const shape = pathShapeOf(splat);
  if (shape != null) {
    // A GitHub shape with no host: the one GitHub host is the canonical one.
    return {
      kind: 'redirect',
      splat: `${GITHUB_HOSTS[0]}:${splat}`,
      status: 302,
    };
  }
  return { kind: 'none' };
}
