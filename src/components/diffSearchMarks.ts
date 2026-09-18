import { forEachRenderedRow } from '@/components/diffLineMarks';
import type { SearchMarks, SearchSpan } from '@/lib/diffSearch';

// How the matches from src/lib/diffSearch.ts reach the rendered rows.
//
// The same door `diffLineMarks.ts` uses: the viewer draws each file in a shadow
// root, `onPostRender` hands over the container after every render pass, and
// `unsafeCSS` installs a stylesheet inside the root. What a search adds is a
// second trigger: the query or the current match changes without a render
// pass, so `ReviewViewer` also walks every rendered container on that change.
//
// The marks are CSS custom highlights and never DOM. A row's text is a run of
// shiki's own spans, and a match can start in one and end in the next; wrapping
// it in a `<mark>` would mean splitting the library's nodes, which its next
// pass rebuilds and its selection code reads. `CSS.highlights` paints a range
// over the text as it stands. The ranges are static ones: a live `Range` is
// moved by the engine on every insertion under it, and a render pass is
// nothing but insertions, where a `StaticRange` over a node the pass threw
// away simply paints nothing.
//
// A scroll pass keeps the rows still in the window and adds the ones that
// arrived, so each row remembers the marks it was painted for and a pass
// paints only the rows that lack them. The rows a pass trimmed give their
// ranges back on the next, or the registry grows by a window's worth per
// scroll. A change of query or of current match is a new marks object, which
// is what repaints every row.

const HIGHLIGHT_ALL = 'ghdiff-search';
const HIGHLIGHT_CURRENT = 'ghdiff-search-current';

/**
 * Installed into every file's shadow root through the `unsafeCSS` option, so
 * the pseudo-element is styled in the tree the ranges live in. The colours are
 * custom properties set in `src/globals.css`, which inherit through the shadow
 * boundary the way `--ghdiff-quiet-opacity` does.
 */
export const SEARCH_MARKS_CSS = `
::highlight(${HIGHLIGHT_ALL}) {
  background-color: var(--app-search-match);
  color: var(--app-search-match-ink);
}
::highlight(${HIGHLIGHT_CURRENT}) {
  background-color: var(--app-search-current);
  color: var(--app-search-current-ink);
}
`;

interface Registry {
  all: Highlight;
  current: Highlight;
}

/**
 * The two registry entries, made once. Null on the server and in a browser
 * without custom highlights, where the search still counts and jumps and marks
 * nothing.
 */
const registry: Registry | null = (() => {
  if (
    typeof CSS === 'undefined' ||
    !('highlights' in CSS) ||
    typeof Highlight === 'undefined'
  ) {
    return null;
  }
  const all = new Highlight();
  const current = new Highlight();
  // Where a match and the current match share a character, the current one
  // paints on top.
  current.priority = 1;
  CSS.highlights.set(HIGHLIGHT_ALL, all);
  CSS.highlights.set(HIGHLIGHT_CURRENT, current);
  return { all, current };
})();

/** What one row was painted with, and the ranges that painting added. */
interface RowPaint {
  marks: SearchMarks;
  ranges: StaticRange[];
}

const paintByRow = new WeakMap<HTMLElement, RowPaint>();

/** The rows each container has painted, so it can take its ranges back. */
const rowsByContainer = new WeakMap<HTMLElement, Set<HTMLElement>>();

function unpaint(row: HTMLElement): void {
  const paint = paintByRow.get(row);
  if (paint == null || registry == null) return;
  paintByRow.delete(row);
  for (const range of paint.ranges) {
    registry.all.delete(range);
    registry.current.delete(range);
  }
}

/** Takes one file's ranges out of the registry. */
export function clearSearchMarks(container: HTMLElement): void {
  const rows = rowsByContainer.get(container);
  if (rows == null) return;
  rowsByContainer.delete(container);
  for (const row of rows) unpaint(row);
}

/**
 * Marks one file's rendered rows for the search on screen. Idempotent: a row
 * already painted for these marks is left alone, a row painted for older ones
 * is painted again, and nothing is painted when `marks` is null.
 */
export function applySearchMarks(
  container: HTMLElement,
  itemId: string,
  marks: SearchMarks | null
): void {
  const root = container.shadowRoot;
  if (root == null || registry == null) return;
  const lines = marks?.index.get(itemId);
  if (marks == null || lines == null) {
    clearSearchMarks(container);
    return;
  }

  const painted = rowsByContainer.get(container) ?? new Set<HTMLElement>();
  for (const row of painted) {
    if (row.isConnected) continue;
    unpaint(row);
    painted.delete(row);
  }

  forEachRenderedRow(root, ({ row, line, side }) => {
    const paint = paintByRow.get(row);
    if (paint?.marks === marks) return;
    if (paint != null) {
      unpaint(row);
      painted.delete(row);
    }
    const spans = lines[side].get(line);
    if (spans == null) return;
    const ranges = paintRow(row, spans, marks.current);
    if (ranges.length === 0) return;
    paintByRow.set(row, { marks, ranges });
    painted.add(row);
  });

  if (painted.size > 0) rowsByContainer.set(container, painted);
  else rowsByContainer.delete(container);
}

/**
 * One range per span, cut in one walk over the row's text. The spans arrive
 * sorted by column and never overlap — they are one regex's matches on one
 * line — so each is closed before the next is opened, and a match that begins
 * in one of shiki's tokens and ends in the next is one range across both.
 */
function paintRow(
  row: HTMLElement,
  spans: readonly SearchSpan[],
  current: number
): StaticRange[] {
  if (registry == null) return [];
  const ranges: StaticRange[] = [];
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let next = 0;
  let startContainer: Text | undefined;
  let startOffset = 0;
  for (
    let node = walker.nextNode();
    node != null && next < spans.length;
    node = walker.nextNode()
  ) {
    const text = node as Text;
    const { length } = text.data;
    if (length === 0) continue;
    const end = offset + length;
    while (next < spans.length) {
      const span = spans[next];
      if (startContainer == null) {
        if (span.start >= end) break;
        startContainer = text;
        startOffset = span.start - offset;
      }
      if (span.end > end) break;
      const range = new StaticRange({
        startContainer,
        startOffset,
        endContainer: text,
        endOffset: span.end - offset,
      });
      (span.ordinal === current ? registry.current : registry.all).add(range);
      ranges.push(range);
      startContainer = undefined;
      next += 1;
    }
    offset = end;
  }
  return ranges;
}
