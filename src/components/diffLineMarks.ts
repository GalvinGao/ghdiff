import type { FileDiffMetadata } from '@pierre/diffs';

import { findLineMarks, type LineMarks } from '@/lib/lineMarks';

// How the marks from src/lib/lineMarks.ts reach the rendered rows.
//
// The viewer draws each file in a shadow root and offers no per-line styling
// option, but it does offer `onPostRender` — called with the file's container
// after every render pass — and `unsafeCSS`, a stylesheet it installs inside
// the shadow root. So the deal is: this module walks the rows the pass just
// rendered and stamps `data-ghdiff-quiet` and `data-ghdiff-moved` on the ones
// the marks name, and LINE_MARKS_CSS says what those stamps look like. A pass
// renders only the virtualized window, so each walk touches tens of rows, and
// the whole thing re-runs on the next pass because the rows are rebuilt.
//
// The dims are gated by custom properties rather than by re-render:
// `--ghdiff-quiet-opacity` and the moved pair are set on the element around
// the viewer, inherit through the shadow boundary, and flipping them is a
// style write that costs no render — the same trick usePaneWidth plays.
//
// The rows are matched by the library's own `data-line` (the side's line
// number) and `data-line-type`, which its selection and event code also read.
// The hunk separator is matched by `data-separator` and `data-expand-index`,
// hunk N's separator sitting above hunk N — which is where `hunkContext`, the
// name after git's `@@`, belongs: it names the scope the hidden lines above
// the hunk are inside.

/** Installed into every file's shadow root through the `unsafeCSS` option. */
export const LINE_MARKS_CSS = `
[data-ghdiff-quiet] {
  opacity: var(--ghdiff-quiet-opacity, 0.5);
}
[data-ghdiff-moved] {
  opacity: var(--ghdiff-moved-opacity, 0.62);
  box-shadow: inset 2px 0 0 var(--ghdiff-moved-edge, color-mix(in srgb, currentColor 45%, transparent));
}
[data-ghdiff-scope] {
  margin-left: 16px;
  opacity: 0.65;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
 * Stamps one file's rendered rows and separators. Idempotent, and called from
 * `onPostRender` on every mount and update pass.
 */
export function applyLineMarks(
  container: HTMLElement,
  fileDiff: FileDiffMetadata | undefined
): void {
  const root = container.shadowRoot;
  if (root == null || fileDiff == null) return;

  applyScopeLabels(root, fileDiff);

  const marks = marksFor(fileDiff);
  if (marks == null) return;
  const rows = root.querySelectorAll<HTMLElement>(
    '[data-line][data-line-type="change-deletion"], [data-line][data-line-type="change-addition"]'
  );
  for (const row of rows) {
    const line = Number(row.getAttribute('data-line'));
    const deletion = row.getAttribute('data-line-type') === 'change-deletion';
    const moved = deletion ? marks.movedDeletions : marks.movedAdditions;
    const quiet = deletion ? marks.quietDeletions : marks.quietAdditions;
    if (moved.has(line)) {
      row.setAttribute('data-ghdiff-moved', '');
    } else if (quiet.has(line)) {
      row.setAttribute('data-ghdiff-quiet', '');
    }
  }
}

/**
 * Writes each hunk's `hunkContext` into the separator above it, beside the
 * unmodified-lines count. The trailing separator's index is one past the last
 * hunk and never names a scope, so it is skipped by the same lookup.
 */
function applyScopeLabels(root: ShadowRoot, fileDiff: FileDiffMetadata): void {
  const separators = root.querySelectorAll<HTMLElement>(
    '[data-separator="line-info"][data-expand-index]'
  );
  for (const separator of separators) {
    const index = Number(separator.getAttribute('data-expand-index'));
    const context = fileDiff.hunks[index]?.hunkContext?.trim();
    if (context == null || context === '') continue;
    const content = separator.querySelector('[data-separator-content]');
    if (content == null) continue;
    let label = content.querySelector('[data-ghdiff-scope]');
    if (label == null) {
      label = document.createElement('span');
      label.setAttribute('data-ghdiff-scope', '');
      content.appendChild(label);
    }
    if (label.textContent !== context) label.textContent = context;
  }
}
