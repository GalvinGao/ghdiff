// Browser storage keys. Three of them are read on the server, by the pre-paint
// scripts that interpolate a key into their own source text — the colour mode,
// the code font, and the watch list — so this module must stay free of any
// browser-only import.
export const COLOR_MODE_STORAGE_KEY = 'ghdiff-color-mode';
export const CODE_FONT_STORAGE_KEY = 'ghdiff-code-font';
export const GITHUB_TOKEN_STORAGE_KEY = 'ghdiff-github-token';
export const WATCHED_REPOS_STORAGE_KEY = 'ghdiff-watched-repos';
export const VIEWER_CONTROLS_STORAGE_KEY = 'ghdiff-viewer-controls';
export const RAIL_COLLAPSED_STORAGE_KEY = 'ghdiff-rail-collapsed';
export const SIDEBAR_WIDTH_STORAGE_KEY = 'ghdiff-sidebar-width';
export const RAIL_WIDTH_STORAGE_KEY = 'ghdiff-rail-width';
export const COMMENT_AUTHOR_FILTER_STORAGE_KEY = 'ghdiff-comment-authors';
export const ARCHIVE_HYDRATION_STORAGE_KEY = 'ghdiff-archive-hydration';

/** Comments for one review target, when they cannot go to GitHub. */
export function localCommentsStorageKey(targetKey: string): string {
  return `ghdiff-comments:${targetKey}`;
}

/** The files marked read on one review target, when GitHub keeps no such mark. */
export function localViewedFilesStorageKey(targetKey: string): string {
  return `ghdiff-viewed:${targetKey}`;
}
