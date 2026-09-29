import type { FileDiffMetadata, SelectionSide } from '@pierre/diffs';

import { forEachRenderedRow, rangesForSpans } from '@/components/diffLineMarks';
import {
  type EffectFold,
  type EffectHints,
  type EffectLineHint,
  findEffectHints,
} from '@/lib/lenses/effect/effectHints';

// How the Effect lens's reading, in src/lib/lenses/effect/effectHints.ts,
// reaches the rendered rows.
//
// Three marks. The `yield*` keyword is dimmed with a CSS custom highlight, the
// way a search match is painted. A reading whose expression sits on one line
// is a fold: the expression is hidden and a button stands where it stood,
// wearing the label, the way GoLand draws `if err != nil { return err }` as
// `: err ↗`; pressing it shows the code again, and pressing it once more puts
// the label back. A reading whose expression runs onto another line cannot
// fold — a row is the viewer's unit of layout, in both columns of a split view
// — and keeps a label after the code instead.
//
// A fold is the one mark here that changes the library's own nodes, and three
// rules keep that safe. It changes only the inside of a row: the viewer builds
// every row from an HTML string and counts the rows of a column, so a node
// beside a row would throw that count off, where one inside it is rebuilt with
// it. It is idempotent: a scroll pass keeps the rows still in the window,
// changes and all, so a row already folded for its hint is left alone. And it
// adds no text: the hidden code stays in the row, only wrapped, and the
// button's label is generated content, so a column counted from the start of
// the line is still the same column — which is what the search marks, the cron
// hint and the `yield*` ranges all count by.
//
// Everything is dropped rather than hidden when the switch is off: the rows on
// screen are walked once, the way a change of search query walks them, and
// the render passes after that paint nothing.

const HIGHLIGHT_YIELD = 'ghdiff-effect-yield';

/**
 * Installed into every file's shadow root through the `unsafeCSS` option. The
 * colours are custom properties from `src/globals.css`, which inherit through
 * the shadow boundary.
 *
 * The fold's button is 16px in a 20px row, top-aligned with 2px above it, so
 * it never makes the row taller: out of wrap mode the virtualizer measures no
 * row and lays every one out at the line height.
 *
 * The trailing label is positioned absolutely at its static position, which is
 * the end of the line's own text, so a long line pushes it into the clip
 * rather than onto a second row. Both labels are generated content with an
 * empty alternative after the `/`, which keeps them out of the line's
 * accessible text, where they would read as code; the button's `aria-label`
 * and the row's `title` say the reading instead.
 */
export const EFFECT_HINTS_CSS = `
::highlight(${HIGHLIGHT_YIELD}) {
  color: var(--app-effect-yield-ink);
}

[data-ghdiff-fold-part]:not([data-open]) {
  display: none;
}
[data-ghdiff-fold-part][data-open] {
  background: var(--app-effect-fold-open);
}
[data-ghdiff-fold] {
  all: unset;
  display: inline-block;
  box-sizing: border-box;
  height: 16px;
  margin-block-start: 2px;
  margin-inline: 1px;
  padding-inline: 6px;
  vertical-align: top;
  border-radius: 4px;
  background: var(--app-effect-hint-surface);
  color: var(--app-effect-hint-ink);
  font-family: var(--app-font-sans);
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  white-space: pre;
  cursor: pointer;
  user-select: none;
}
[data-ghdiff-fold]::before {
  content: attr(data-label) / "";
}
[data-ghdiff-fold][data-open]::before {
  content: "−" / "";
}
[data-ghdiff-fold][data-open] {
  padding-inline: 4px;
}
[data-ghdiff-fold]:hover {
  background: var(--app-effect-hint-surface-hover);
  color: var(--app-ink);
}
[data-ghdiff-fold]:focus-visible {
  outline: 2px solid var(--app-accent);
  outline-offset: 1px;
}
/* A change the fold is hiding: the diff's own word highlight is under the
   label, so the label wears the change's colour at its edge instead. */
[data-ghdiff-fold][data-changed]:not([data-open]) {
  box-shadow: inset 0 -2px 0 var(--app-effect-fold-changed);
}
[data-line-type='change-addition'] [data-ghdiff-fold] {
  --app-effect-fold-changed: var(--app-added);
}
[data-line-type='change-deletion'] [data-ghdiff-fold] {
  --app-effect-fold-changed: var(--app-removed);
}

[data-ghdiff-effect] {
  position: relative;
  overflow: clip;
}
[data-ghdiff-effect]::after {
  content: attr(data-ghdiff-effect) / "";
  position: absolute;
  margin-inline-start: 1.25em;
  padding-inline: 0.5em;
  /* The chip is the row's own height, which is what centres its text on the
     code's, and the transparent border is what gives it air above and below:
     the background stops at the padding box. */
  border-block: 3px solid transparent;
  background: var(--app-effect-hint-surface) padding-box;
  border-radius: 6px;
  color: var(--app-effect-hint-ink);
  font-family: var(--app-font-sans);
  font-size: 11px;
  line-height: calc(1lh - 6px);
  white-space: pre;
  pointer-events: none;
  user-select: none;
}
[data-ghdiff-effect][data-ghdiff-cron]::after {
  content: attr(data-ghdiff-effect) "   " attr(data-ghdiff-cron) / "";
}
`;

/**
 * The one registry entry, made once. Null on the server and in a browser
 * without custom highlights, where the folds and labels still draw and the
 * keyword keeps its colour.
 */
const yieldHighlight: Highlight | null = (() => {
  if (
    typeof CSS === 'undefined' ||
    !('highlights' in CSS) ||
    typeof Highlight === 'undefined'
  ) {
    return null;
  }
  const highlight = new Highlight();
  CSS.highlights.set(HIGHLIGHT_YIELD, highlight);
  return highlight;
})();

/**
 * The reading is computed once per metadata object and state of hydration.
 * Hydration mutates the object in place and turns a file of hunks into a whole
 * file, which reads better — so `isPartial` is part of the key.
 */
const hintsByFileDiff = new WeakMap<
  FileDiffMetadata,
  { partial: boolean; hints: EffectHints | null }
>();

function hintsFor(fileDiff: FileDiffMetadata): EffectHints | null {
  const cached = hintsByFileDiff.get(fileDiff);
  if (cached?.partial === fileDiff.isPartial) return cached.hints;
  const hints = findEffectHints(fileDiff) ?? null;
  hintsByFileDiff.set(fileDiff, { partial: fileDiff.isPartial, hints });
  return hints;
}

/**
 * The folds a reviewer has opened, per file. A row is rebuilt whenever it
 * scrolls out and back, so the choice is kept here rather than on the row,
 * and the metadata object is the key because a filter change keeps it.
 */
const openFoldsByFileDiff = new WeakMap<FileDiffMetadata, Set<string>>();

function openFolds(fileDiff: FileDiffMetadata): Set<string> {
  let open = openFoldsByFileDiff.get(fileDiff);
  if (open == null) {
    open = new Set();
    openFoldsByFileDiff.set(fileDiff, open);
  }
  return open;
}

function foldKey(side: SelectionSide, line: number, fold: EffectFold): string {
  return `${side}:${line}:${fold.start}`;
}

/**
 * How to open the fold a hidden part belongs to, for the search: a match the
 * reviewer steps onto must be on screen, and inside a closed fold it is not.
 */
const openerByPart = new WeakMap<Element, () => void>();

/**
 * Opens the fold that hides `node`, if one does. The search calls this for
 * its current match after every pass, and the fold stays open from then on,
 * the way it would had the reviewer pressed its label.
 */
export function openFoldHolding(node: Node): void {
  const part = node.parentElement?.closest(
    '[data-ghdiff-fold-part]:not([data-open])'
  );
  if (part != null) openerByPart.get(part)?.();
}

/** What one row was painted with, and the ranges that painting added. */
interface RowPaint {
  hint: EffectLineHint;
  ranges: StaticRange[];
}

const paintByRow = new WeakMap<HTMLElement, RowPaint>();

/** The rows each container has painted, so it can take its marks back. */
const rowsByContainer = new WeakMap<HTMLElement, Set<HTMLElement>>();

function unpaint(row: HTMLElement): void {
  const paint = paintByRow.get(row);
  if (paint == null) return;
  paintByRow.delete(row);
  for (const range of paint.ranges) yieldHighlight?.delete(range);
  for (const button of row.querySelectorAll('[data-ghdiff-fold]')) {
    button.remove();
  }
  for (const part of row.querySelectorAll('[data-ghdiff-fold-part]')) {
    const parent = part.parentNode;
    while (part.firstChild != null) parent?.insertBefore(part.firstChild, part);
    part.remove();
  }
  if (row.hasAttribute('data-ghdiff-effect')) {
    row.removeAttribute('data-ghdiff-effect');
    if (!row.hasAttribute('data-ghdiff-cron')) row.removeAttribute('title');
  }
}

/** Takes one file's marks back, rows and registry alike. */
export function clearEffectHints(container: HTMLElement): void {
  const rows = rowsByContainer.get(container);
  if (rows == null) return;
  rowsByContainer.delete(container);
  for (const row of rows) unpaint(row);
}

/**
 * Marks one file's rendered rows. Idempotent: a row already painted for its
 * line's hint is left alone, and nothing is painted when `enabled` is false.
 * Called after `applyCronSchedules`, so a row with both keeps the schedule's
 * tooltip.
 */
export function applyEffectHints(
  container: HTMLElement,
  fileDiff: FileDiffMetadata | undefined,
  enabled: boolean
): void {
  const root = container.shadowRoot;
  if (root == null) return;
  const hints = enabled && fileDiff != null ? hintsFor(fileDiff) : null;
  if (hints == null || fileDiff == null) {
    clearEffectHints(container);
    return;
  }

  const painted = rowsByContainer.get(container) ?? new Set<HTMLElement>();
  for (const row of painted) {
    if (row.isConnected) continue;
    unpaint(row);
    painted.delete(row);
  }

  const open = openFolds(fileDiff);
  forEachRenderedRow(root, ({ row, line, side }) => {
    const hint = hints[side].get(line);
    const paint = paintByRow.get(row);
    // A highlighter pass can replace the text under a row it keeps, and a
    // range over a node it threw away paints nothing.
    if (
      paint != null &&
      paint.hint === hint &&
      paint.ranges.every((range) => range.startContainer.isConnected)
    ) {
      return;
    }
    if (paint != null) {
      unpaint(row);
      painted.delete(row);
    }
    if (hint == null) return;

    for (const fold of hint.folds) {
      const key = foldKey(side, line, fold);
      foldRange(row, fold, open.has(key), (isOpen) => {
        if (isOpen) open.add(key);
        else open.delete(key);
      });
    }
    const ranges =
      yieldHighlight == null ? [] : rangesForSpans(row, hint.yields);
    for (const range of ranges) yieldHighlight?.add(range);
    if (hint.label != null) {
      row.dataset.ghdiffEffect = hint.label;
      if (hint.title != null && !row.hasAttribute('data-ghdiff-cron')) {
        row.title = hint.title;
      }
    }
    paintByRow.set(row, { hint, ranges });
    painted.add(row);
  });

  if (painted.size > 0) rowsByContainer.set(container, painted);
  else rowsByContainer.delete(container);
}

/**
 * Wraps the text of one fold in hidden parts and puts its button in front of
 * them. The text nodes are split at the fold's two edges, which leaves shiki's
 * spans where they are: a fold that starts inside one token and ends inside
 * another hides the tail of the one and the head of the other.
 */
function foldRange(
  row: HTMLElement,
  fold: EffectFold,
  isOpen: boolean,
  remember: (isOpen: boolean) => void
): void {
  const pieces = isolateText(row, fold.start, fold.end);
  const first = pieces[0];
  if (first == null) return;

  const parts = pieces.map((piece) => {
    const part = document.createElement('span');
    part.setAttribute('data-ghdiff-fold-part', '');
    piece.parentNode?.insertBefore(part, piece);
    part.appendChild(piece);
    return part;
  });

  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-ghdiff-fold', '');
  button.dataset.label = fold.label;
  if (parts.some((part) => part.closest('[data-diff-span]') != null)) {
    button.setAttribute('data-changed', '');
  }
  const [reading] = fold.title.split('\n');
  const show = (next: boolean) => {
    button.toggleAttribute('data-open', next);
    for (const part of parts) part.toggleAttribute('data-open', next);
    button.setAttribute('aria-expanded', String(next));
    button.setAttribute(
      'aria-label',
      next
        ? `Fold the code back into “${fold.label}”`
        : `${reading} Show the code.`
    );
    button.title = next ? 'Fold' : fold.title;
  };
  show(isOpen);
  const open = () => {
    remember(true);
    show(true);
  };
  for (const part of parts) openerByPart.set(part, open);
  // The viewer's own click handler reads no target, so a press here must not
  // reach it and be taken for a press on the line.
  button.addEventListener('pointerdown', (event) => event.stopPropagation());
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const next = !button.hasAttribute('data-open');
    remember(next);
    show(next);
  });
  parts[0]!.parentNode?.insertBefore(button, parts[0]!);
}

/**
 * The text nodes that hold columns `start` to `end` of a row, split so that
 * each lies wholly inside the range. Every node is collected before any is
 * split, since a split would move a live walker.
 */
function isolateText(row: HTMLElement, start: number, end: number): Text[] {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node != null; node = walker.nextNode()) {
    nodes.push(node as Text);
  }

  const pieces: Text[] = [];
  let offset = 0;
  for (const node of nodes) {
    const nodeStart = offset;
    const nodeEnd = offset + node.data.length;
    offset = nodeEnd;
    if (nodeEnd <= start || nodeStart >= end) continue;
    let piece = node;
    if (start > nodeStart) piece = piece.splitText(start - nodeStart);
    const pieceStart = Math.max(start, nodeStart);
    if (end < nodeEnd) piece.splitText(end - pieceStart);
    pieces.push(piece);
  }
  return pieces;
}
