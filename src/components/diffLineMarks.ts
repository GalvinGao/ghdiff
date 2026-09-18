import type { FileDiffMetadata, SelectionSide } from '@pierre/diffs';

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
// `forEachRenderedRow` is the one reading of the library's row attributes, for
// this mark and for the search's. The rows are matched by its own `data-line`
// and `data-line-type`, which its selection and event code also read, and the
// column by the `data-deletions`, `data-additions` or `data-unified` on the
// `code` element around them.

/** Installed into every file's shadow root through the `unsafeCSS` option. */
export const LINE_MARKS_CSS = `
[data-ghdiff-quiet] {
  opacity: var(--ghdiff-quiet-opacity, 0.5);
}
`;

/** One row of code as the viewer drew it. */
export interface RenderedRow {
  row: HTMLElement;
  /** The line number the row carries, which is a number on `side`. */
  line: number;
  /**
   * The side of the diff the row is drawn for. In a split view that is its
   * own column; in a unified view a deleted line is the old side and every
   * other row the new one, a context line included.
   */
  side: SelectionSide;
}

/**
 * Walks the code rows a render pass left in one file's shadow root, in
 * document order. Gutter cells carry `data-column-number` and not `data-line`,
 * so they are never visited.
 */
export function forEachRenderedRow(
  root: ShadowRoot,
  visit: (row: RenderedRow) => void
): void {
  for (const column of root.querySelectorAll<HTMLElement>('code[data-code]')) {
    const columnSide: SelectionSide | undefined = column.hasAttribute(
      'data-deletions'
    )
      ? 'deletions'
      : column.hasAttribute('data-additions')
        ? 'additions'
        : undefined;
    const rows = column.querySelectorAll<HTMLElement>(
      '[data-content] > [data-line]'
    );
    for (const row of rows) {
      const side =
        columnSide ??
        (row.dataset.lineType === 'change-deletion'
          ? 'deletions'
          : 'additions');
      visit({ row, line: Number(row.dataset.line), side });
    }
  }
}

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
  forEachRenderedRow(root, ({ row, line, side }) => {
    const type = row.dataset.lineType;
    if (type !== 'change-deletion' && type !== 'change-addition') return;
    const quiet =
      side === 'deletions' ? marks.quietDeletions : marks.quietAdditions;
    if (quiet.has(line)) row.setAttribute('data-ghdiff-quiet', '');
  });
}
