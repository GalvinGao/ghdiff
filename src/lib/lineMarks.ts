import type {
  ChangeContent,
  FileDiffMetadata,
  Hunk,
  SelectedLineRange,
} from '@pierre/diffs';

// Which changed lines say less than their colour claims.
//
// A diff paints every changed line red or green, and on a line whose two sides
// differ only in whitespace the paint overstates: that is a formatting pass,
// not a change a reviewer must judge. SemanticDiff hides such lines; ghdiff
// dims them, which keeps every line on screen — a dim line can still be read,
// selected and commented on, so a wrong call here costs emphasis and never
// information.
//
// Everything here is computed from the patch alone — the hunks' own change
// blocks and their lines — so it is ready the moment the diff is parsed and
// never waits on a file fetch. That is also its honest limit: without a syntax
// tree it cannot know that `0x80` is `128`, only that two lines are the same
// text differently spaced.

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
  };

  for (const hunk of fileDiff.hunks) {
    for (const block of hunk.hunkContent) {
      if (block.type !== 'change') continue;
      collectQuietPairs(fileDiff, hunk, block, marks);
    }
  }

  return marks.quietDeletions.size > 0 ? marks : undefined;
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

/**
 * Whether a selected range touches a line the diff does not change — a
 * context line. On a merge request a staged comment can only sit on a changed
 * line: GitLab takes a draft note at any position and then fails the whole
 * publish for it, so the composer asks this before offering the stage action
 * there. GitHub refuses a bad position as the comment is staged, so a pull
 * request does not ask. Same patch-only arithmetic as `findLineMarks`, ready at
 * parse time.
 */
export function rangeTouchesContextLines(
  fileDiff: LineMarksSource,
  range: SelectedLineRange
): boolean {
  const changed = changedLines(fileDiff);
  const endSide = range.endSide ?? range.side ?? 'additions';
  const startSide = range.side ?? endSide;
  const setFor = (side: 'additions' | 'deletions') =>
    side === 'deletions' ? changed.deletions : changed.additions;
  if (startSide === endSide) {
    const set = setFor(endSide);
    const [lo, hi] =
      range.start <= range.end
        ? [range.start, range.end]
        : [range.end, range.start];
    for (let line = lo; line <= hi; line++) {
      if (!set.has(line)) return true;
    }
    return false;
  }
  // A range across the sides names one line at each end.
  return !setFor(startSide).has(range.start) || !setFor(endSide).has(range.end);
}

/** Every line a file's change blocks hold, as line numbers per side. */
function changedLines(fileDiff: LineMarksSource): {
  additions: Set<number>;
  deletions: Set<number>;
} {
  const additions = new Set<number>();
  const deletions = new Set<number>();
  for (const hunk of fileDiff.hunks) {
    for (const block of hunk.hunkContent) {
      if (block.type !== 'change') continue;
      for (let i = 0; i < block.additions; i++) {
        additions.add(
          lineNumberAt(
            hunk.additionStart,
            hunk.additionLineIndex,
            block.additionLineIndex + i
          )
        );
      }
      for (let i = 0; i < block.deletions; i++) {
        deletions.add(
          lineNumberAt(
            hunk.deletionStart,
            hunk.deletionLineIndex,
            block.deletionLineIndex + i
          )
        );
      }
    }
  }
  return { additions, deletions };
}
