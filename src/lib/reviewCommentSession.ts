import type { DiffLineAnnotation } from '@pierre/diffs';

import type { CommentMetadata } from './comments.ts';
import type { RawThread } from './commentThreads.ts';

export interface CommentState {
  byItemId: Map<string, DiffLineAnnotation<CommentMetadata>[]>;
  unplaced: RawThread[];
  revision: number;
}

export const EMPTY_COMMENT_STATE: CommentState = {
  byItemId: new Map(),
  unplaced: [],
  revision: 0,
};

/** A list fetched before a write completed must not undo that write. */
export function reconcileCommentRead(
  current: CommentState,
  loaded: Pick<CommentState, 'byItemId' | 'unplaced'>
): CommentState {
  const byItemId = new Map(loaded.byItemId);
  for (const [itemId, annotations] of current.byItemId) {
    for (const annotation of annotations) {
      const local = annotation.metadata;
      const list = byItemId.get(itemId) ?? [];
      const rootId = local.comments?.[0]?.githubId;
      const remote = list.find(
        (a) =>
          a.metadata.key === local.key ||
          (rootId != null && a.metadata.comments?.[0]?.githubId === rootId)
      );
      const remoteComments =
        remote?.metadata.comments ??
        loaded.unplaced.find((thread) => thread.comments[0].githubId === rootId)
          ?.comments;
      const confirmed =
        remoteComments != null &&
        local.comments?.every(
          (comment) =>
            comment.githubId != null &&
            remoteComments.some((row) => row.githubId === comment.githubId)
        );
      const keep =
        local.kind === 'draft' ||
        local.pending ||
        local.error != null ||
        (local.localWrite && !confirmed);
      if (keep) {
        byItemId.set(itemId, [
          ...list.filter((row) => row !== remote),
          annotation,
        ]);
      } else if (remote != null) {
        // Keep the key used by an open reply composer when GitHub confirms a
        // thread that was first created in this session.
        byItemId.set(
          itemId,
          list.map((row) =>
            row === remote
              ? { ...row, metadata: { ...row.metadata, key: local.key } }
              : row
          )
        );
      }
    }
  }
  return { ...current, ...loaded, byItemId, revision: current.revision + 1 };
}

/** Owned by one mounted PR page, with one instance per version and account. */
export function createReviewCommentSession() {
  let state = EMPTY_COMMENT_STATE;
  const listeners = new Set<() => void>();
  return {
    drafts: new Map<string, string>(),
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(change: (current: CommentState) => CommentState) {
      state = change(state);
      for (const listener of listeners) listener();
    },
  };
}

export type ReviewCommentSession = ReturnType<
  typeof createReviewCommentSession
>;
