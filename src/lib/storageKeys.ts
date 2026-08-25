// Browser storage keys. The pre-paint color mode script reads the first one on
// the server as it builds its source text, so this module must stay free of any
// browser-only import.
export const COLOR_MODE_STORAGE_KEY = 'ghdiff-color-mode';
export const GITHUB_TOKEN_STORAGE_KEY = 'ghdiff-github-token';
export const WATCHED_REPOS_STORAGE_KEY = 'ghdiff-watched-repos';
export const RAIL_COLLAPSED_STORAGE_KEY = 'ghdiff-rail-collapsed';
export const SIDEBAR_WIDTH_STORAGE_KEY = 'ghdiff-sidebar-width';
export const COMMENT_AUTHOR_FILTER_STORAGE_KEY = 'ghdiff-comment-authors';

/** Comments for one review target, when they cannot go to GitHub. */
export function localCommentsStorageKey(targetKey: string): string {
  return `ghdiff-comments:${targetKey}`;
}
