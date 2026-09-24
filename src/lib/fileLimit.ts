// The cap on a file fetched for its unmodified lines, alone in a module of its
// own.
//
// It lives here rather than in `diffHydration.ts` because three ends hold it
// now, and the third has no business importing a diff library. The browser and
// the hosted route both reach it through `diffHydration.ts`, which re-exports
// it; the `ghdiff` command's own server imports this file directly, and pulls
// nothing else along with it.

/**
 * The largest file ghdiff will read for its unmodified lines. Around this size
 * a source file runs to the hundred thousand lines at which the viewer gives up
 * highlighting it, so little above the line improves what is on screen.
 *
 * Every end holds it, and they have to. The hosted route knows only what
 * GitHub's headers say, and `content-length` states the **compressed** size
 * whenever GitHub compressed the answer — 4.8 MB of word list arrives declaring
 * 1.4 MB — and some answers carry no length at all. So that route rejects what
 * it can prove is too big, and the browser counts the bytes it actually
 * decodes, which is where the file becomes a string and where the string is the
 * cost. The local server is the one end that can simply ask: `git cat-file -s`
 * and `stat` both answer exactly, before a byte is sent.
 */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** What every end says when a file runs past it. */
export const FILE_TOO_LARGE =
  'That file is too large to show its unmodified lines.';
