import type { CodeViewDiffItem, DiffLineAnnotation } from '@pierre/diffs';

import { isBotLogin } from './commentAuthors.ts';
import { classifyCommentLineType } from './commentLine.ts';
import {
  type CommentListSection,
  type CommentMetadata,
  isCommentThread,
  threadParticipants,
  threadRoot,
} from './comments.ts';
import type { ReviewFileEntry } from './reviewData.ts';

/**
 * Builds the sidebar list: one row per thread, grouped by file in diff order
 * and by line inside each file. Drafts stay out because they have no body yet.
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

    const threads = annotations
      .flatMap((annotation) => {
        const metadata = annotation.metadata;
        if (!isCommentThread(metadata)) return [];
        const root = threadRoot(metadata);
        return [
          {
            itemId: item.id,
            path: entry.path,
            key: metadata.key,
            author: root.author,
            authorAvatarUrl: root.authorAvatarUrl,
            // GitHub's own answer when there is one, and the login when there
            // is not: a browser-stored comment keeps no user object.
            authorIsBot: root.authorIsBot ?? isBotLogin(root.author),
            body: root.body,
            replyCount: metadata.comments.length - 1,
            participants: threadParticipants(metadata),
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
          },
        ];
      })
      .sort((a, b) => a.lineNumber - b.lineNumber);

    if (threads.length === 0) continue;
    sections.push({
      itemId: item.id,
      path: entry.path,
      fileOrder: entry.fileOrder,
      threads,
    });
  }

  return sections.sort((a, b) => a.fileOrder - b.fileOrder);
}

/** Total messages across every thread, which is what the tab badge counts. */
export function countComments(sections: readonly CommentListSection[]): number {
  let total = 0;
  for (const section of sections) {
    for (const thread of section.threads) {
      total += 1 + thread.replyCount;
    }
  }
  return total;
}

export function countThreads(sections: readonly CommentListSection[]): number {
  let total = 0;
  for (const section of sections) {
    total += section.threads.length;
  }
  return total;
}
