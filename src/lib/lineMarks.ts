import type { ChangeContent, FileDiffMetadata, Hunk } from '@pierre/diffs';

// Which changed lines say less than their colour claims.
//
// A diff paints every changed line red or green, and on two kinds of line the
// paint overstates. A line whose two sides differ only in whitespace is a
// formatting pass, not a change a reviewer must judge. And a line that left
// one place and landed unaltered in another is code the reviewer has already
// read once. SemanticDiff hides the first kind and draws the second as a move;
// ghdiff dims the first and edges the second, which keeps every line on
// screen — a dim line can still be read, selected and commented on, so a wrong
// call here costs emphasis and never information.
//
// Everything here is computed from the patch alone — the hunks' own change
// blocks and their lines — so it is ready the moment the diff is parsed and
// never waits on a file fetch. That is also its honest limit: without a syntax
// tree it cannot know that `0x80` is `128`, only that two lines are the same
// text differently spaced, or the same text somewhere else.

/**
 * A moved block must be at least this many lines. One or two matching lines
 * are how ordinary edits look — a closing brace, a blank line, an import —
 * and marking those as moves would mark most diffs.
 */
const MIN_MOVED_BLOCK_LINES = 3;

/**
 * And its lines must carry at least this many non-whitespace characters
 * between them, which is git's own floor for `--color-moved`: three brace
 * lines are three matching lines and still say nothing.
 */
const MIN_MOVED_BLOCK_CHARS = 20;

/**
 * A line whose text appears in the additions more often than this never
 * anchors a move: it is punctuation of the language, not an address, and
 * chasing every occurrence would make the search quadratic on brace-heavy
 * files.
 */
const MAX_ANCHOR_OCCURRENCES = 10;

/** The subset of a file diff this module reads, so tests can hand it any
    `parsePatchFiles` output directly. */
export type LineMarksSource = Pick<
  FileDiffMetadata,
  'hunks' | 'deletionLines' | 'additionLines'
>;

export interface LineMarks {
  /** Old-side line numbers whose pair differs only in whitespace. */
  quietDeletions: Set<number>;
  /** New-side line numbers whose pair differs only in whitespace. */
  quietAdditions: Set<number>;
  /** Old-side line numbers of blocks that reappear unaltered elsewhere. */
  movedDeletions: Set<number>;
  /** New-side line numbers those blocks reappear on. */
  movedAdditions: Set<number>;
}

/** One changed line of a block, addressed by the number the gutter shows. */
interface ChangedLine {
  line: number;
  /** The text without its line break or surrounding whitespace, so a block
      keeps matching after a re-indent. */
  norm: string;
  /** The text without any whitespace at all, for the two equality tests. */
  bare: string;
}

/**
 * Marks for one file, or nothing when the file has none — which is most
 * files, and what lets a caller keep no entry for them.
 */
export function findLineMarks(
  fileDiff: LineMarksSource
): LineMarks | undefined {
  const marks: LineMarks = {
    quietDeletions: new Set(),
    quietAdditions: new Set(),
    movedDeletions: new Set(),
    movedAdditions: new Set(),
  };

  const deletions: ChangedLine[] = [];
  const additions: ChangedLine[] = [];

  for (const hunk of fileDiff.hunks) {
    for (const block of hunk.hunkContent) {
      if (block.type !== 'change') continue;
      collectQuietPairs(fileDiff, hunk, block, marks);
      // What the whitespace pass claimed is already explained, so the move
      // search never sees it: a line equal to its own pair cannot also have
      // "come from" somewhere else.
      collectChangedLines(
        fileDiff.deletionLines,
        hunk.deletionStart,
        hunk.deletionLineIndex,
        block.deletionLineIndex,
        block.deletions,
        marks.quietDeletions,
        deletions
      );
      collectChangedLines(
        fileDiff.additionLines,
        hunk.additionStart,
        hunk.additionLineIndex,
        block.additionLineIndex,
        block.additions,
        marks.quietAdditions,
        additions
      );
    }
  }

  findMovedBlocks(deletions, additions, marks);

  return marks.quietDeletions.size > 0 ||
    marks.quietAdditions.size > 0 ||
    marks.movedDeletions.size > 0
    ? marks
    : undefined;
}

/** The line number a side's flat array index answers to, inside one hunk. */
function lineNumberAt(
  hunkStart: number,
  hunkLineIndex: number,
  arrayIndex: number
): number {
  return hunkStart + (arrayIndex - hunkLineIndex);
}

function stripAllWhitespace(text: string): string {
  return text.replace(/\s+/g, '');
}

/**
 * Pairs a block's deleted and added lines by position, the way intraline
 * highlighting does, and records the pairs that differ only in whitespace.
 * The rule is `git diff -w`: any change of spacing, indentation included.
 * That deliberately covers whitespace inside a string literal, where spacing
 * can matter — a dim keeps such a line readable, and the intraline highlight
 * still lands on the exact characters.
 */
function collectQuietPairs(
  fileDiff: LineMarksSource,
  hunk: Hunk,
  block: ChangeContent,
  marks: LineMarks
): void {
  const pairs = Math.min(block.deletions, block.additions);
  for (let offset = 0; offset < pairs; offset++) {
    const deleted = fileDiff.deletionLines[block.deletionLineIndex + offset];
    const added = fileDiff.additionLines[block.additionLineIndex + offset];
    if (deleted == null || added == null) continue;
    if (stripAllWhitespace(deleted) !== stripAllWhitespace(added)) continue;
    marks.quietDeletions.add(
      lineNumberAt(
        hunk.deletionStart,
        hunk.deletionLineIndex,
        block.deletionLineIndex + offset
      )
    );
    marks.quietAdditions.add(
      lineNumberAt(
        hunk.additionStart,
        hunk.additionLineIndex,
        block.additionLineIndex + offset
      )
    );
  }
}

function collectChangedLines(
  sideLines: readonly string[],
  hunkStart: number,
  hunkLineIndex: number,
  blockLineIndex: number,
  blockCount: number,
  quiet: ReadonlySet<number>,
  into: ChangedLine[]
): void {
  for (let offset = 0; offset < blockCount; offset++) {
    const text = sideLines[blockLineIndex + offset];
    if (text == null) continue;
    const line = lineNumberAt(
      hunkStart,
      hunkLineIndex,
      blockLineIndex + offset
    );
    if (quiet.has(line)) continue;
    const norm = text.replace(/\r?\n$/, '').trim();
    into.push({ line, norm, bare: stripAllWhitespace(norm) });
  }
}

/**
 * Finds deleted blocks that reappear as added blocks, by exact text with
 * indentation allowed to differ. Anchors are uncommon lines; a match extends
 * up and down while both sides stay equal, unclaimed, and contiguous in
 * their own file. Contiguity is what keeps a block a block: the flat arrays
 * run across hunks, and a match must not.
 */
function findMovedBlocks(
  deletions: readonly ChangedLine[],
  additions: readonly ChangedLine[],
  marks: LineMarks
): void {
  if (deletions.length < MIN_MOVED_BLOCK_LINES) return;
  const byNorm = new Map<string, number[]>();
  additions.forEach((added, index) => {
    if (added.bare === '') return;
    const list = byNorm.get(added.norm);
    if (list == null) byNorm.set(added.norm, [index]);
    else list.push(index);
  });

  const matchedDeletions = new Array<boolean>(deletions.length).fill(false);
  const matchedAdditions = new Array<boolean>(additions.length).fill(false);

  for (let anchor = 0; anchor < deletions.length; anchor++) {
    if (matchedDeletions[anchor]) continue;
    const entry = deletions[anchor];
    if (entry == null || entry.bare === '') continue;
    const candidates = byNorm.get(entry.norm);
    if (candidates == null || candidates.length > MAX_ANCHOR_OCCURRENCES) {
      continue;
    }

    let best: { start: number; addedStart: number; length: number } | null =
      null;
    for (const candidate of candidates) {
      if (matchedAdditions[candidate]) continue;
      const match = extendMatch(
        deletions,
        additions,
        matchedDeletions,
        matchedAdditions,
        anchor,
        candidate
      );
      if (best == null || match.length > best.length) best = match;
    }
    if (best == null || best.length < MIN_MOVED_BLOCK_LINES) continue;

    let significantChars = 0;
    for (let offset = 0; offset < best.length; offset++) {
      significantChars += deletions[best.start + offset]?.bare.length ?? 0;
    }
    if (significantChars < MIN_MOVED_BLOCK_CHARS) continue;

    for (let offset = 0; offset < best.length; offset++) {
      const deleted = deletions[best.start + offset];
      const added = additions[best.addedStart + offset];
      if (deleted == null || added == null) continue;
      matchedDeletions[best.start + offset] = true;
      matchedAdditions[best.addedStart + offset] = true;
      marks.movedDeletions.add(deleted.line);
      marks.movedAdditions.add(added.line);
    }
  }
}

/** How far a match at (anchor, candidate) reaches in both directions. */
function extendMatch(
  deletions: readonly ChangedLine[],
  additions: readonly ChangedLine[],
  matchedDeletions: readonly boolean[],
  matchedAdditions: readonly boolean[],
  anchor: number,
  candidate: number
): { start: number; addedStart: number; length: number } {
  const stillEqual = (
    deletionIndex: number,
    additionIndex: number
  ): boolean => {
    const deleted = deletions[deletionIndex];
    const added = additions[additionIndex];
    return (
      deleted != null &&
      added != null &&
      !matchedDeletions[deletionIndex] &&
      !matchedAdditions[additionIndex] &&
      deleted.norm === added.norm
    );
  };
  const contiguous = (
    lines: readonly ChangedLine[],
    from: number,
    to: number
  ): boolean => {
    const a = lines[from];
    const b = lines[to];
    return a != null && b != null && Math.abs(b.line - a.line) === 1;
  };

  let up = 0;
  while (
    stillEqual(anchor - up - 1, candidate - up - 1) &&
    contiguous(deletions, anchor - up, anchor - up - 1) &&
    contiguous(additions, candidate - up, candidate - up - 1)
  ) {
    up += 1;
  }
  let down = 0;
  while (
    stillEqual(anchor + down + 1, candidate + down + 1) &&
    contiguous(deletions, anchor + down, anchor + down + 1) &&
    contiguous(additions, candidate + down, candidate + down + 1)
  ) {
    down += 1;
  }
  return {
    start: anchor - up,
    addedStart: candidate - up,
    length: up + down + 1,
  };
}
