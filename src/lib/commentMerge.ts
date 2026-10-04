// A newer list of GitHub's threads, laid over the threads one tab is drawing.
//
// The list arrives when another tab posts, deletes or answers, and when the
// reviewer presses reload. Either way the tab receiving it may be holding
// things GitHub does not have — a composer with half a sentence in it, a
// reply still on its way, a failure with the reviewer's text in it — and
// replacing the whole set with GitHub's would throw those away. So GitHub's
// list is the truth about what GitHub has, and this tab's state is the truth
// about everything else.

import type { DiffLineAnnotation } from '@pierre/diffs';

import {
  type CommentMetadata,
  type CommentThread,
  isCommentThread,
} from './comments.ts';

type Annotation = DiffLineAnnotation<CommentMetadata>;
type ByItemId = ReadonlyMap<string, readonly Annotation[]>;

/**
 * Whether an annotation is this tab's to draw as it is: a composer, a thread
 * GitHub has not got at all, or one with a message still on its way. A thread
 * GitHub has, with a message that failed to reach it, is GitHub's copy with
 * that message laid on the end — see `keepIdentity`.
 */
export function isOnlyInThisTab(metadata: CommentMetadata): boolean {
  if (metadata.kind === 'draft') return true;
  if (metadata.pending === true || metadata.creatingIssue === true) return true;
  return isCommentThread(metadata) && metadata.comments[0].githubId == null;
}

function rootId(metadata: CommentMetadata): number | undefined {
  return isCommentThread(metadata) ? metadata.comments[0].githubId : undefined;
}

/**
 * GitHub's copy of a thread, under the keys this tab already drew it with. A
 * card mounted under one key and handed another is a card mounted again, and
 * the viewer measures every card it mounts. Three things only this tab knows
 * are carried over: the issue link, held in memory alone; every message that
 * never reached GitHub, with the reviewer's text in it, after GitHub's own; and
 * the failure that says so.
 */
function keepIdentity(annotation: Annotation, held: CommentThread): Annotation {
  const metadata = annotation.metadata;
  const unsent = held.comments.filter((comment) => comment.githubId == null);
  const keyById = new Map<number, string>();
  for (const comment of held.comments) {
    if (comment.githubId != null) keyById.set(comment.githubId, comment.key);
  }
  return {
    ...annotation,
    metadata: {
      ...metadata,
      key: held.key,
      comments: [
        ...(metadata.comments ?? []).map((comment) => {
          const key =
            comment.githubId == null
              ? undefined
              : keyById.get(comment.githubId);
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
 * The threads to draw: every thread GitHub has, and everything only this tab
 * has. A thread this tab is still adding to wins over GitHub's copy of it,
 * because its copy holds the message GitHub has not got yet; the next answer
 * after that message lands brings the two back together.
 */
export function mergeGitHubThreads(
  fromGitHub: ByItemId,
  current: ByItemId
): Map<string, Annotation[]> {
  const heldByRoot = new Map<number, CommentThread>();
  const busyRoots = new Set<number>();
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
      }
    }
  }

  const merged = new Map<string, Annotation[]>();
  for (const [itemId, list] of fromGitHub) {
    const drawn: Annotation[] = [];
    for (const annotation of list) {
      const id = rootId(annotation.metadata);
      if (id != null && busyRoots.has(id)) continue;
      const held = id == null ? undefined : heldByRoot.get(id);
      drawn.push(held == null ? annotation : keepIdentity(annotation, held));
    }
    if (drawn.length > 0) merged.set(itemId, drawn);
  }
  for (const [itemId, list] of onlyHere) {
    merged.set(itemId, [...(merged.get(itemId) ?? []), ...list]);
  }
  return merged;
}
