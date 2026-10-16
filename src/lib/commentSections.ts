import type { CodeViewDiffItem, DiffLineAnnotation } from '@pierre/diffs';

import { isBotLogin } from './commentAuthors';
import { classifyCommentLineType } from './commentLine';
import {
  type CommentListEntry,
  type CommentListSection,
  type CommentMetadata,
  type CommentThread,
  isCommentThread,
  threadParticipants,
  threadRoot,
} from './comments';
import type { ReviewFileEntry } from './reviewData';

/**
 * The fields every thread row shares, whichever section builds it: who opened
 * the thread, what it says, and how it stands. Each file section spreads its
 * own extras over this.
 */
function listEntryFromThread(
  itemId: string,
  path: string,
  metadata: CommentThread
): Omit<CommentListEntry, 'lineNumber' | 'lineType' | 'side' | 'range'> {
  const root = threadRoot(metadata);
  return {
    itemId,
    path,
    key: metadata.key,
    author: root.author,
    authorAvatarUrl: root.authorAvatarUrl,
    // GitHub's own answer when there is one, and the login when there is
    // not: a browser-stored comment keeps no user object.
    authorIsBot: root.authorIsBot ?? isBotLogin(root.author),
    body: root.body,
    replyCount: metadata.comments.length - 1,
    messages: metadata.comments,
    participants: threadParticipants(metadata),
    resolved: metadata.resolved,
    // A posted thread holding a reply staged on the pending review draws the
    // chip too: that reply goes up with the verdict like any draft.
    staged:
      metadata.staged === true ||
      metadata.comments.some((comment) => comment.staged === true)
        ? true
        : metadata.staged,
    pending: metadata.pending,
    error: metadata.error,
  };
}

/** Open threads first; a resolved one lists after them. */
function compareResolvedLast(
  a: Pick<CommentListEntry, 'resolved'>,
  b: Pick<CommentListEntry, 'resolved'>
): number {
  return Number(a.resolved === true) - Number(b.resolved === true);
}

/**
 * Builds the sidebar list: one row per thread, grouped by file in diff order
 * and by line inside each file. Unsaved composers stay out — they have no
 * body yet. Resolved threads list after the open ones inside their section:
 * they are read when somebody asks, not while scanning for what is still open.
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
        return [
          {
            ...listEntryFromThread(item.id, entry.path, metadata),
            lineNumber: annotation.lineNumber,
            lineType: classifyCommentLineType(
              item.fileDiff,
              annotation.side,
              annotation.lineNumber
            ),
            side: annotation.side,
            range: metadata.range,
          },
        ];
      })
      .sort((a, b) => compareResolvedLast(a, b) || a.lineNumber - b.lineNumber);

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
