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

import type { ReviewTarget } from './reviewTarget.ts';

const GITHUB = 'https://github.com';

export interface RepoRef {
  owner: string;
  repo: string;
}

/** ghdiff's own repository, for the two links in the home page's footer. */
export const GHDIFF_REPO: RepoRef = { owner: 'GalvinGao', repo: 'ghdiff' };

/** The repository's own page. */
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
export function reviewTargetUrl(target: ReviewTarget): string {
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
