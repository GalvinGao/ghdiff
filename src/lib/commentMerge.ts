// A newer list of the forge's threads, laid over the threads one tab is
// drawing.
//
// The list arrives when another tab posts, deletes or answers, and when the
// reviewer presses reload. Either way the tab receiving it may be holding
// things the forge does not have — a composer with half a sentence in it, a
// reply still on its way, a failure with the reviewer's text in it — and
// replacing the whole set with the forge's would throw those away. So the
// forge's list is the truth about what the forge has, and this tab's state is
// the truth about everything else.
//
// A thread is known by its root's remote id, and by which list it came from:
// a draft and a posted comment are read from two lists, so the two never stand
// for each other.

import type { DiffLineAnnotation } from '@pierre/diffs';

import {
  type CommentMetadata,
  type CommentThread,
  isCommentThread,
} from './comments';

type Annotation = DiffLineAnnotation<CommentMetadata>;
type ByItemId = ReadonlyMap<string, readonly Annotation[]>;

/**
 * Whether an annotation is this tab's to draw as it is: a composer, a thread
 * the forge has not got at all, or one with a message still on its way. A
 * thread the forge has, with a message that failed to reach it, is the forge's
 * copy with that message laid on the end — see `keepIdentity`.
 */
export function isOnlyInThisTab(metadata: CommentMetadata): boolean {
  if (metadata.kind === 'draft') return true;
  if (metadata.pending === true || metadata.creatingIssue === true) return true;
  return isCommentThread(metadata) && metadata.comments[0].remoteId == null;
}

function rootId(metadata: CommentMetadata): string | undefined {
  if (!isCommentThread(metadata)) return undefined;
  const id = metadata.comments[0].remoteId;
  if (id == null) return undefined;
  return `${metadata.staged === true ? 'staged' : 'remote'}:${id}`;
}

/**
 * The forge's copy of a thread, under the keys this tab already drew it with.
 * A card mounted under one key and handed another is a card mounted again,
 * and the viewer measures every card it mounts. Three things only this tab
 * knows are carried over: the issue link, held in memory alone; every message
 * that never reached the forge, with the reviewer's text in it, after the
 * forge's own; and the failure that says so.
 */
function keepIdentity(annotation: Annotation, held: CommentThread): Annotation {
  const metadata = annotation.metadata;
  const unsent = held.comments.filter((comment) => comment.remoteId == null);
  const keyById = new Map<number, string>();
  for (const comment of held.comments) {
    if (comment.remoteId != null) keyById.set(comment.remoteId, comment.key);
  }
  return {
    ...annotation,
    metadata: {
      ...metadata,
      key: held.key,
      comments: [
        ...(metadata.comments ?? []).map((comment) => {
          const key =
            comment.remoteId == null
              ? undefined
              : keyById.get(comment.remoteId);
          return key == null ? comment : { ...comment, key };
        }),
        ...unsent,
      ],
      ...(held.issue == null ? {} : { issue: held.issue }),
      ...(held.error == null ? {} : { error: held.error }),
    },
  };
}

/**
 * The threads to draw: every thread the forge has, and everything only this
 * tab has. A thread this tab is still adding to wins over the forge's copy of
 * it, because its copy holds the message the forge has not got yet; the next
 * answer after that message lands brings the two back together.
 */
export function mergeForgeThreads(
  fromForge: ByItemId,
  current: ByItemId
): Map<string, Annotation[]> {
  const heldByRoot = new Map<string, CommentThread>();
  /** Where each held thread with unsent text was drawn, by its root. */
  const unsentByRoot = new Map<
    string,
    { itemId: string; annotation: Annotation }
  >();
  const busyRoots = new Set<string>();
  const onlyHere = new Map<string, Annotation[]>();

  for (const [itemId, list] of current) {
    for (const annotation of list) {
      const metadata = annotation.metadata;
      const id = rootId(metadata);
      if (isOnlyInThisTab(metadata)) {
        const kept = onlyHere.get(itemId) ?? [];
        kept.push(annotation);
        onlyHere.set(itemId, kept);
        if (id != null) busyRoots.add(id);
      } else if (id != null && isCommentThread(metadata)) {
        heldByRoot.set(id, metadata);
        if (metadata.comments.some((comment) => comment.remoteId == null)) {
          unsentByRoot.set(id, { itemId, annotation });
        }
      }
    }
  }

  const merged = new Map<string, Annotation[]>();
  const onForge = new Set<string>();
  for (const [itemId, list] of fromForge) {
    const drawn: Annotation[] = [];
    for (const annotation of list) {
      const id = rootId(annotation.metadata);
      if (id != null) onForge.add(id);
      if (id != null && busyRoots.has(id)) continue;
      const held = id == null ? undefined : heldByRoot.get(id);
      drawn.push(held == null ? annotation : keepIdentity(annotation, held));
    }
    if (drawn.length > 0) merged.set(itemId, drawn);
  }
  // A thread whose root the forge no longer lists — deleted elsewhere — goes,
  // unless this tab holds text in it that never reached the forge. That text
  // is the reviewer's and nowhere else, so the thread stays as this tab drew
  // it.
  for (const [id, { itemId, annotation }] of unsentByRoot) {
    if (onForge.has(id)) continue;
    const kept = onlyHere.get(itemId) ?? [];
    kept.push(annotation);
    onlyHere.set(itemId, kept);
  }
  for (const [itemId, list] of onlyHere) {
    merged.set(itemId, [...(merged.get(itemId) ?? []), ...list]);
  }
  return merged;
}
