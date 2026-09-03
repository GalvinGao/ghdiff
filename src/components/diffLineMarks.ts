import type { FileDiffMetadata } from '@pierre/diffs';

import { findLineMarks, type LineMarks } from '@/lib/lineMarks';

// How the marks from src/lib/lineMarks.ts reach the rendered rows.
//
// The viewer draws each file in a shadow root and offers no per-line styling
// option, but it does offer `onPostRender` — called with the file's container
// after every render pass — and `unsafeCSS`, a stylesheet it installs inside
// the shadow root. So the deal is: this module walks the rows the pass just
// rendered and stamps `data-ghdiff-quiet` on the ones the marks name, and
// LINE_MARKS_CSS says what the stamp looks like. A pass renders only the
// virtualized window, so each walk touches tens of rows, and the whole thing
// re-runs on the next pass because the rows are rebuilt.
//
// The dim is gated by a custom property rather than by re-render:
// `--ghdiff-quiet-opacity` is set on the element around the viewer, inherits
// through the shadow boundary, and flipping it is a style write that costs no
// render — the same trick usePaneWidth plays.
//
// The rows are matched by the library's own `data-line` (the side's line
// number) and `data-line-type`, which its selection and event code also read.

/** Installed into every file's shadow root through the `unsafeCSS` option. */
export const LINE_MARKS_CSS = `
[data-ghdiff-quiet] {
  opacity: var(--ghdiff-quiet-opacity, 0.5);
}
`;

/**
 * Marks are pure arithmetic over a file's own change blocks, so they are
 * computed once per metadata object and remembered here. Hydration mutates
 * that object in place without touching the change blocks, and a filter
 * change keeps the same reference, so an entry never goes stale.
 */
const marksByFileDiff = new WeakMap<FileDiffMetadata, LineMarks | null>();

function marksFor(fileDiff: FileDiffMetadata): LineMarks | null {
  const cached = marksByFileDiff.get(fileDiff);
  if (cached !== undefined) return cached;
  const marks = findLineMarks(fileDiff) ?? null;
  marksByFileDiff.set(fileDiff, marks);
  return marks;
}

/**
 * Stamps one file's rendered rows. Idempotent, and called from
 * `onPostRender` on every mount and update pass.
 */
export function applyLineMarks(
  container: HTMLElement,
  fileDiff: FileDiffMetadata | undefined
): void {
  const root = container.shadowRoot;
  if (root == null || fileDiff == null) return;

  const marks = marksFor(fileDiff);
  if (marks == null) return;
  const rows = root.querySelectorAll<HTMLElement>(
    '[data-line][data-line-type="change-deletion"], [data-line][data-line-type="change-addition"]'
  );
  for (const row of rows) {
    const line = Number(row.getAttribute('data-line'));
    const deletion = row.getAttribute('data-line-type') === 'change-deletion';
    const quiet = deletion ? marks.quietDeletions : marks.quietAdditions;
    if (quiet.has(line)) {
      row.setAttribute('data-ghdiff-quiet', '');
    }
  }
}
