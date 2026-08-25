import type { AnnotationSide, FileDiffMetadata } from '@pierre/diffs';

import type { CommentLineType } from './comments.ts';

/**
 * Classifies a 1-based line number on one diff side as a real addition or
 * deletion, or as an unchanged context line. The sidebar reads this so it does
 * not print `+13` for a line that was never added.
 *
 * It walks each hunk's ordered content while it tracks the running line number
 * on the requested side. A context block of N lines advances both sides by N. A
 * change block advances the addition side by its additions and the deletion
 * side by its deletions.
 */
export function classifyCommentLineType(
  fileDiff: FileDiffMetadata,
  side: AnnotationSide,
  lineNumber: number
): CommentLineType {
  for (const hunk of fileDiff.hunks) {
    let current =
      side === 'additions' ? hunk.additionStart : hunk.deletionStart;
    const count =
      side === 'additions' ? hunk.additionCount : hunk.deletionCount;
    if (lineNumber < current || lineNumber >= current + count) {
      continue;
    }
    for (const content of hunk.hunkContent) {
      const length =
        content.type === 'context'
          ? content.lines
          : side === 'additions'
            ? content.additions
            : content.deletions;
      if (length === 0) continue;
      if (lineNumber < current + length) {
        return content.type === 'context' ? 'context' : 'change';
      }
      current += length;
    }
  }
  return 'change';
}
