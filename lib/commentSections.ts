import type { CodeViewDiffItem, DiffLineAnnotation } from '@pierre/diffs';

import { classifyCommentLineType } from './commentLine.ts';
import {
  type CommentListSection,
  type CommentMetadata,
  isSavedComment,
} from './comments.ts';
import type { ReviewFileEntry } from './reviewData.ts';

/**
 * Builds the sidebar comment list: saved comments only, grouped by file in diff
 * order, and by line inside each file. Drafts stay out because they have no
 * body yet.
 */
export function buildCommentSections(
  items: readonly CodeViewDiffItem<CommentMetadata>[],
  annotationsByItemId: ReadonlyMap<
    string,
    readonly DiffLineAnnotation<CommentMetadata>[]
  >,
  entries: readonly ReviewFileEntry[]
): CommentListSection[] {
  const entryByItemId = new Map(entries.map((entry) => [entry.itemId, entry]));
  const sections: CommentListSection[] = [];

  for (const item of items) {
    const annotations = annotationsByItemId.get(item.id);
    if (annotations == null || annotations.length === 0) continue;
    const entry = entryByItemId.get(item.id);
    if (entry == null) continue;

    const comments = annotations
      .filter((annotation) => isSavedComment(annotation.metadata))
      .map((annotation) => {
        const metadata = annotation.metadata;
        if (!isSavedComment(metadata)) {
          throw new Error('Unreachable: the filter above kept saved comments.');
        }
        return {
          itemId: item.id,
          path: entry.path,
          key: metadata.key,
          author: metadata.author,
          body: metadata.body,
          lineNumber: annotation.lineNumber,
          lineType: classifyCommentLineType(
            item.fileDiff,
            annotation.side,
            annotation.lineNumber
          ),
          side: annotation.side,
          range: metadata.range,
          pending: metadata.pending,
          error: metadata.error,
          htmlUrl: metadata.htmlUrl,
        };
      })
      .sort((a, b) => a.lineNumber - b.lineNumber);

    if (comments.length === 0) continue;
    sections.push({
      itemId: item.id,
      path: entry.path,
      fileOrder: entry.fileOrder,
      comments,
    });
  }

  return sections.sort((a, b) => a.fileOrder - b.fileOrder);
}

export function countComments(sections: readonly CommentListSection[]): number {
  let total = 0;
  for (const section of sections) {
    total += section.comments.length;
  }
  return total;
}
