// Browser storage keys.
//
// This module carries no 'use client' marker on purpose. The pre-paint color
// mode script is a server component, and a constant imported from a client
// module reaches the server as a client reference rather than as its value.
export const COLOR_MODE_STORAGE_KEY = 'reviewer-color-mode';
export const GITHUB_TOKEN_STORAGE_KEY = 'reviewer-github-token';
export const WATCHED_REPOS_STORAGE_KEY = 'reviewer-watched-repos';
export const RAIL_COLLAPSED_STORAGE_KEY = 'reviewer-rail-collapsed';
export const SIDEBAR_WIDTH_STORAGE_KEY = 'reviewer-sidebar-width';
export const COMMENT_AUTHOR_FILTER_STORAGE_KEY = 'reviewer-comment-authors';

/** Comments for one review target, when they cannot go to GitHub. */
export function localCommentsStorageKey(targetKey: string): string {
  return `reviewer-comments:${targetKey}`;
}
