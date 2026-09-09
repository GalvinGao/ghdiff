import type { FileDiffMetadata, SelectionSide } from '@pierre/diffs';

import type { DiffStyle } from './viewerControls.ts';

// Find in diff.
//
// The browser's own find reads the DOM, and the diff is virtualized: only the
// files under the viewport are rendered, so Cmd+F finds a word on screen and
// misses the same word two files down. This module searches the patch instead
// of the page. It walks every line of every hunk in the order the viewer draws
// them, and answers with positions the viewer can scroll to and a rendered row
// can mark.
//
// A match is a place on screen, and the count is the count of places. A
// context line is drawn once in a unified view and twice in a split one, on
// each side under its own number, so it is one match or two by the same rule,
// and Enter walks a split row left to right before it goes down. The lines it
// reads are the hunks' own. The unmodified lines a reviewer expands around a
// hunk are not searched: they live in the viewer's rendered instance, which
// nothing outside it can read, and github.com's own find misses them too, since
// it never renders them.

export interface SearchMatch {
  itemId: string;
  /**
   * The side the line is drawn on. A context line in a unified view answers as
   * `additions`; in a split view it is two matches, one per side.
   */
  side: SelectionSide;
  lineNumber: number;
  /** Column of the first matched character, zero-based. */
  start: number;
  /** Column after the last matched character. */
  end: number;
}

/** What the walk reads off a viewer item. `parsePatchFiles` output fits it. */
export interface SearchableItem {
  id: string;
  fileDiff: FileDiffMetadata;
}

export interface DiffSearchResult {
  matches: readonly SearchMatch[];
  /** True when the walk stopped at the cap with lines still unread. */
  truncated: boolean;
}

export interface SearchOptions {
  /** How the viewer draws the lines, which is how many places each one is. */
  diffStyle: DiffStyle;
  limit?: number;
}

/**
 * Where the walk stops. A query of one letter over a 43 MB patch matches on
 * most lines, and a list that long is not something a reviewer steps through
 * with Enter. The bar prints the cap with a plus after it.
 */
const MAX_SEARCH_MATCHES = 10_000;

const EMPTY_SEARCH_RESULT: DiffSearchResult = { matches: [], truncated: false };

const SIDES: readonly SelectionSide[] = ['deletions', 'additions'];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sees one line as the view draws it: its text, and the number it carries on
 * each side it is drawn on. A deleted line has an old number and an added line
 * a new one; a context line has both in a split view and the new one alone in
 * a unified view. Answers false to stop the walk.
 */
type LineVisitor = (
  text: string | undefined,
  oldLine: number | undefined,
  newLine: number | undefined
) => boolean;

/**
 * Walks one file's lines in the order the view draws them. Unified prints a
 * change block's deleted lines before its added ones. Split pairs them row by
 * row, the left side before the right, and draws a context line on both sides
 * at once. Answers false when the visitor stopped it.
 */
function walkDrawnLines(
  fileDiff: FileDiffMetadata,
  split: boolean,
  visit: LineVisitor
): boolean {
  const { hunks, additionLines, deletionLines } = fileDiff;
  for (const hunk of hunks) {
    // The line number a side's array index answers to, inside this hunk.
    const oldNumber = (index: number) =>
      hunk.deletionStart + (index - hunk.deletionLineIndex);
    const newNumber = (index: number) =>
      hunk.additionStart + (index - hunk.additionLineIndex);
    const deleted = (index: number) =>
      visit(deletionLines[index], oldNumber(index), undefined);
    const added = (index: number) =>
      visit(additionLines[index], undefined, newNumber(index));

    for (const block of hunk.hunkContent) {
      if (block.type === 'context') {
        for (let row = 0; row < block.lines; row++) {
          const index = block.additionLineIndex + row;
          const oldLine = split
            ? oldNumber(block.deletionLineIndex + row)
            : undefined;
          if (!visit(additionLines[index], oldLine, newNumber(index))) {
            return false;
          }
        }
      } else if (!split) {
        for (let row = 0; row < block.deletions; row++) {
          if (!deleted(block.deletionLineIndex + row)) return false;
        }
        for (let row = 0; row < block.additions; row++) {
          if (!added(block.additionLineIndex + row)) return false;
        }
      } else {
        const rows = Math.max(block.deletions, block.additions);
        for (let row = 0; row < rows; row++) {
          if (
            row < block.deletions &&
            !deleted(block.deletionLineIndex + row)
          ) {
            return false;
          }
          if (row < block.additions && !added(block.additionLineIndex + row)) {
            return false;
          }
        }
      }
    }
  }
  return true;
}

/**
 * Every place the query occurs, file by file as the viewer lists them and then
 * in the order `walkDrawnLines` states. Case-insensitive and literal, the way
 * the browser's own find is; the regex is only a way to fold case without
 * lowercasing a million lines first, and it runs once per line however many
 * sides the line is drawn on.
 */
export function searchDiff(
  items: readonly SearchableItem[],
  query: string,
  { diffStyle, limit = MAX_SEARCH_MATCHES }: SearchOptions
): DiffSearchResult {
  if (query.length === 0) return EMPTY_SEARCH_RESULT;
  const split = diffStyle === 'split';
  const pattern = new RegExp(escapeRegExp(query), 'gi');
  const matches: SearchMatch[] = [];
  let truncated = false;

  for (const item of items) {
    const visit: LineVisitor = (text, oldLine, newLine) => {
      if (text == null) return true;
      pattern.lastIndex = 0;
      let found = pattern.exec(text);
      if (found == null) return true;
      // One hit past what the cap has room for is enough to prove truncation,
      // so a minified line is never scanned to its end for hits that would
      // only be thrown away.
      const room = limit - matches.length + 1;
      const hits: [number, number][] = [];
      for (; found != null && hits.length < room; found = pattern.exec(text)) {
        hits.push([found.index, found.index + found[0].length]);
      }
      // A match per place the line is drawn, the old side first: it is the
      // left column, and the only side a unified view leaves out.
      for (const side of SIDES) {
        const lineNumber = side === 'deletions' ? oldLine : newLine;
        if (lineNumber == null) continue;
        for (const [start, end] of hits) {
          if (matches.length >= limit) {
            truncated = true;
            return false;
          }
          matches.push({ itemId: item.id, side, lineNumber, start, end });
        }
      }
      return true;
    };
    if (!walkDrawnLines(item.fileDiff, split, visit)) break;
  }

  return { matches, truncated };
}

export function isSameMatch(a: SearchMatch, b: SearchMatch): boolean {
  return (
    a.itemId === b.itemId &&
    a.side === b.side &&
    a.lineNumber === b.lineNumber &&
    a.start === b.start &&
    a.end === b.end
  );
}

/**
 * Where a fresh search starts: the first match in the file the reviewer is
 * reading, or in the first file after it, and the top of the list when there
 * is none past that point. The browser's own find starts from the viewport
 * for the same reason, and a search that always began at the top of a
 * thousand-file diff would drag the reviewer away from the file they were on.
 */
export function nearestMatchIndex(
  matches: readonly SearchMatch[],
  items: readonly { id: string }[],
  activeItemId: string | undefined
): number {
  if (matches.length === 0) return -1;
  const activeOrder =
    activeItemId == null
      ? -1
      : items.findIndex((item) => item.id === activeItemId);
  if (activeOrder <= 0) return 0;
  const after = new Set<string>();
  for (let order = activeOrder; order < items.length; order++) {
    after.add(items[order].id);
  }
  const index = matches.findIndex((match) => after.has(match.itemId));
  return index === -1 ? 0 : index;
}

/** One match on one line, and its place in the list. */
export interface SearchSpan {
  start: number;
  end: number;
  /** The match's index in `DiffSearchResult.matches`. */
  ordinal: number;
}

export interface LineSearchIndex {
  additions: ReadonlyMap<number, readonly SearchSpan[]>;
  deletions: ReadonlyMap<number, readonly SearchSpan[]>;
}

/** Per file, per side, per line: what the rendered rows look themselves up by. */
export type SearchIndex = ReadonlyMap<string, LineSearchIndex>;

/**
 * What the viewer marks its rows with: every match by line, and which of them
 * the reviewer is on, as an ordinal into the list or -1 for none.
 */
export interface SearchMarks {
  index: SearchIndex;
  current: number;
}

export function indexMatchesByLine(
  matches: readonly SearchMatch[]
): SearchIndex {
  const index = new Map<
    string,
    {
      additions: Map<number, SearchSpan[]>;
      deletions: Map<number, SearchSpan[]>;
    }
  >();
  for (const [ordinal, match] of matches.entries()) {
    let file = index.get(match.itemId);
    if (file == null) {
      file = { additions: new Map(), deletions: new Map() };
      index.set(match.itemId, file);
    }
    const lines = file[match.side];
    let spans = lines.get(match.lineNumber);
    if (spans == null) {
      spans = [];
      lines.set(match.lineNumber, spans);
    }
    spans.push({ start: match.start, end: match.end, ordinal });
  }
  return index;
}
