import type { AnnotationSide, FileDiffMetadata } from '@pierre/diffs';

import type { CommentLineType } from './comments.ts';

/**
 * Where a 1-based line number on one diff side sits: whether the block holding
 * it is a change or context, and the index of its text in that side's array.
 *
 * The hunks are ordered and disjoint on each side, so their end boundaries
 * locate the containing hunk without scanning all preceding hunks. Then one
 * walk steps its content while tracking the running line number on the requested
 * side: a context block of N lines advances both sides by N, and a change block
 * advances the addition side by its additions and the deletion side by its
 * deletions. Every block carries the offset into the side's line array where it
 * starts, so a hit resolves to text without re-reading the patch.
 *
 * Note the two `additionLines`: `Hunk.additionLines` is a count of `+` lines
 * and `FileDiffMetadata.additionLines` is the array of text. The index this
 * returns is into the second.
 */
function locateLine(
  fileDiff: FileDiffMetadata,
  side: AnnotationSide,
  lineNumber: number
): { lineType: CommentLineType; index: number } | undefined {
  const additions = side === 'additions';
  let low = 0;
  let high = fileDiff.hunks.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const hunk = fileDiff.hunks[middle];
    const end = additions
      ? hunk.additionStart + hunk.additionCount
      : hunk.deletionStart + hunk.deletionCount;
    if (end <= lineNumber) low = middle + 1;
    else high = middle;
  }
  const hunk = fileDiff.hunks[low];
  if (hunk == null) return undefined;
  let current = additions ? hunk.additionStart : hunk.deletionStart;
  if (lineNumber < current) return undefined;
  for (const content of hunk.hunkContent) {
    const length =
      content.type === 'context'
        ? content.lines
        : side === 'additions'
          ? content.additions
          : content.deletions;
    if (length === 0) continue;
    if (lineNumber < current + length) {
      const start =
        side === 'additions'
          ? content.additionLineIndex
          : content.deletionLineIndex;
      return {
        lineType: content.type === 'context' ? 'context' : 'change',
        index: start + (lineNumber - current),
      };
    }
    current += length;
  }
  return undefined;
}

/**
 * Classifies a 1-based line number on one diff side as a real addition or
 * deletion, or as an unchanged context line. The sidebar reads this so it does
 * not print `+13` for a line that was never added.
 *
 * A line no hunk claims answers 'change', which is what an annotation anchored
 * outside the diff this app holds is treated as everywhere else.
 */
export function classifyCommentLineType(
  fileDiff: FileDiffMetadata,
  side: AnnotationSide,
  lineNumber: number
): CommentLineType {
  return locateLine(fileDiff, side, lineNumber)?.lineType ?? 'change';
}

/**
 * The text of one line on one diff side, or nothing when the diff does not
 * hold it.
 *
 * `FileDiffMetadata.additionLines` and `deletionLines` are the real strings of
 * each side, context lines included, and the walk above gives the index.
 *
 * The line ending comes off. Those arrays hold each line as the patch carried
 * it, terminator and all, and a caller that quotes several of them back to back
 * would otherwise get a blank line between every pair.
 */
export function commentLineText(
  fileDiff: FileDiffMetadata,
  side: AnnotationSide,
  lineNumber: number
): string | undefined {
  const found = locateLine(fileDiff, side, lineNumber);
  if (found == null) return undefined;
  const text =
    side === 'additions' ? fileDiff.additionLines : fileDiff.deletionLines;
  const line = text[found.index];
  return line == null ? undefined : withoutLineEnding(line);
}

/** `\n` or `\r\n`, and nothing else: a line's text is not its terminator. */
function withoutLineEnding(line: string): string {
  if (line.endsWith('\r\n')) return line.slice(0, -2);
  if (line.endsWith('\n')) return line.slice(0, -1);
  return line;
}
