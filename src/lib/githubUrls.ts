// Where a thing on screen lives on github.com.
//
// Every name the app prints is a name GitHub has a page for, and a reviewer who
// reads one usually wants the other. These are the addresses of those pages,
// built in one place: a query string assembled at a call site is a query string
// that will be assembled differently at the next one.
//
// Every one of these opens in a new tab at the call site. ghdiff is a place a
// reviewer stays, and a link that replaced the diff with github.com would cost
// them the scroll position, the filter and the fragment they had built up.

import type { GitHubReviewTarget } from './reviewTarget.ts';

const GITHUB = 'https://github.com';

export interface RepoRef {
  owner: string;
  repo: string;
}

/** ghdiff's own repository, for the two links in the home page's footer. */
export const GHDIFF_REPO: RepoRef = { owner: 'GalvinGao', repo: 'ghdiff' };

/**
 * An account's picture, person or organization alike. github.com answers
 * `/<login>.png` with a redirect to the avatar host, so the list can draw an
 * owner's mark without asking the API who that owner is. `size` is the side in
 * device pixels, which GitHub scales the picture to.
 */
export function accountAvatarUrl(login: string, size: number): string {
  return `${GITHUB}/${encodeURIComponent(login)}.png?size=${String(size)}`;
}

/** The repository's own page. */
/**
 * Where a reviewer manages their fine-grained personal access tokens, which is
 * where the one an older ghdiff asked for is deleted. Removing it from this
 * browser does not revoke it at GitHub, so the migration notice sends them here.
 * Classic tokens live one page over, under `/settings/tokens`; the form ghdiff
 * used to pre-fill made fine-grained ones, so this is the page that will have it.
 */
export function personalAccessTokensUrl(): string {
  return `${GITHUB}/settings/personal-access-tokens`;
}

export function repoUrl({ owner, repo }: RepoRef): string {
  return `${GITHUB}/${owner}/${repo}`;
}

/** One commit's own page. */
export function commitUrl(ref: RepoRef, sha: string): string {
  return `${repoUrl(ref)}/commit/${sha}`;
}

/**
 * The repository's open pull requests, as GitHub's own search. `is:pr is:open`
 * is what GitHub's own Pull requests tab applies, so the page a reviewer lands
 * on holds the same rows the bar counted. An author narrows it further, which
 * is the same query GitHub builds from its Author menu.
 */
export function repoPullsUrl(
  ref: RepoRef,
  options?: { author?: string }
): string {
  const terms = ['is:pr', 'is:open'];
  if (options?.author != null && options.author.length > 0) {
    terms.push(`author:${options.author}`);
  }
  // URLSearchParams writes a space as `+`, which is what GitHub's own links do.
  const query = new URLSearchParams({ q: terms.join(' ') });
  return `${repoUrl(ref)}/pulls?${query.toString()}`;
}

/** The page the review on screen was taken from. */
export function reviewTargetUrl(target: GitHubReviewTarget): string {
  const root = repoUrl(target);
  switch (target.kind) {
    case 'github-pull':
      return `${root}/pull/${String(target.number)}`;
    case 'github-commit':
      return commitUrl(target, target.sha);
    case 'github-compare':
      // GitHub's own separator between the two refs, and the one the app's own
      // splat route reads back.
      return `${root}/compare/${target.base}...${target.head}`;
  }
}

/**
 * Files github.com renders as a document rather than as code. A line anchor on
 * one of those lands on nothing unless the page is asked for its source with
 * `plain=1`, and an issue that quotes one embeds nothing without it.
 */
const RENDERED_EXTENSIONS = new Set([
  'adoc',
  'asciidoc',
  'markdown',
  'md',
  'mdown',
  'mdx',
  'mkd',
  'mkdn',
  'org',
  'rst',
]);

/**
 * A permanent link to lines of one file at one commit. This is the one shape
 * GitHub turns into an embedded snippet when it is pasted on a line of its own
 * in an issue of the same repository: `blob`, a full commit sha rather than a
 * branch, and a `#L` anchor. A branch name would render as a plain link, and it
 * would also point at different lines tomorrow.
 */
export function blobPermalinkUrl(
  ref: RepoRef,
  sha: string,
  path: string,
  lines: { start: number; end: number }
): string {
  const start = Math.min(lines.start, lines.end);
  const end = Math.max(lines.start, lines.end);
  const anchor = start === end ? `L${start}` : `L${start}-L${end}`;
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  const query = RENDERED_EXTENSIONS.has(extension) ? '?plain=1' : '';
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `${repoUrl(ref)}/blob/${sha}/${encodedPath}${query}#${anchor}`;
}
