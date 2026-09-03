import type { DiffLineAnnotation, SelectedLineRange } from '@pierre/diffs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { readStoredJson, writeStoredString } from './useLocalStorage';
import {
  commentPayloadRangeFields,
  type CommentMetadata,
  type CommentPayload,
  isCommentThread,
  rangeFromCommentPayload,
} from '@/lib/comments';
import { groupCommentThreads, threadComments } from '@/lib/commentThreads';
import type { ReviewFileEntry } from '@/lib/reviewData';
import {
  type ReviewTarget,
  reviewTargetKey,
  supportsGitHubComments,
} from '@/lib/reviewTarget';
import { rpc, rpcErrorMessage } from '@/lib/rpc/client';
import { localCommentsStorageKey } from '@/lib/storageKeys';

// Where a comment lives depends on the target. A GitHub pull request keeps its
// comments on GitHub, so a comment written here shows up on github.com. Every
// other target has no upstream review thread, so those comments stay in this
// browser and the sidebar says so.

export type CommentStore = 'github' | 'local';

type Annotation = DiffLineAnnotation<CommentMetadata>;
export type AnnotationsByItemId = ReadonlyMap<string, readonly Annotation[]>;

/**
 * Annotations and their revision move together: the viewer keys an item update
 * off id and version, so a changed annotation set is meaningless without a new
 * revision. One state object makes that impossible to get wrong.
 */
interface CommentState {
  byItemId: Map<string, Annotation[]>;
  revision: number;
}

const EMPTY_STATE: CommentState = { byItemId: new Map(), revision: 0 };

export interface ReviewCommentsState {
  store: CommentStore;
  annotationsByItemId: AnnotationsByItemId;
  /** Increases whenever any annotation changes, so items bump their version. */
  revision: number;
  loading: boolean;
  error?: string;
  /** Opens an empty composer on the last line of the selection. */
  startDraft(itemId: string, range: SelectedLineRange): void;
  /** Turns a draft into a saved comment and writes it to the store. */
  saveDraft(itemId: string, key: string, body: string): void;
  /** Adds a message to the end of a thread that already exists. */
  replyToThread(itemId: string, key: string, body: string): void;
  /** Removes a draft, or deletes a saved comment from its store. */
  removeComment(itemId: string, key: string): void;
  reload(): void;
}

interface StoredLocalComment extends CommentPayload {
  key: string;
}

/** One annotation per thread, anchored where the thread's root sits. */
function annotationFromThread(
  key: string,
  payloads: readonly CommentPayload[],
  comments: ReturnType<typeof threadComments>
): Annotation {
  const root = payloads[0];
  return {
    side: root.side,
    lineNumber: root.line,
    metadata: {
      kind: 'thread',
      key,
      range: rangeFromCommentPayload(root),
      comments,
    },
  };
}

/** Flattens every message of every thread back into browser-storage rows. */
function toStoredRows(
  state: CommentState,
  pathByItemId: ReadonlyMap<string, string>
): StoredLocalComment[] {
  const rows: StoredLocalComment[] = [];
  for (const [itemId, list] of state.byItemId) {
    const path = pathByItemId.get(itemId);
    if (path == null) continue;
    for (const annotation of list) {
      const metadata = annotation.metadata;
      if (!isCommentThread(metadata)) continue;
      const range = commentPayloadRangeFields(metadata.range);
      for (const comment of metadata.comments) {
        rows.push({
          key: comment.key,
          // Names the thread, so a reply written here is still a reply after a
          // reload. There is no GitHub id for it to point at.
          threadKey: metadata.key,
          path,
          author: comment.author,
          authorIsBot: comment.authorIsBot,
          body: comment.body,
          createdAt: comment.createdAt,
          ...range,
        });
      }
    }
  }
  return rows;
}

export function useReviewComments(options: {
  target: ReviewTarget;
  entries: readonly ReviewFileEntry[];
  viewerLogin?: string;
  /** True once the diff is parsed. Comments only map onto known files. */
  ready: boolean;
}): ReviewCommentsState {
  const { entries, ready, target, viewerLogin } = options;
  const store: CommentStore = supportsGitHubComments(target)
    ? 'github'
    : 'local';

  // `target` arrives from a server component, so its object identity changes
  // whenever the RSC payload is read again. Every loader below depends on these
  // derived strings instead, which compare by value.
  const storageKey = localCommentsStorageKey(reviewTargetKey(target));
  const pullOwner = target.kind === 'github-pull' ? target.owner : undefined;
  const pullRepo = target.kind === 'github-pull' ? target.repo : undefined;
  const pullNumber = target.kind === 'github-pull' ? target.number : undefined;

  const [state, setState] = useState<CommentState>(EMPTY_STATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const nextKeyRef = useRef(0);
  // One load at a time. A reload, or a new diff, cancels the request in flight
  // so a slow answer cannot overwrite a newer one.
  const controllerRef = useRef<AbortController | null>(null);

  const itemIdByPath = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) {
      if (!map.has(entry.path)) map.set(entry.path, entry.itemId);
    }
    return map;
  }, [entries]);

  const pathByItemId = useMemo(
    () => new Map(entries.map((entry) => [entry.itemId, entry.path])),
    [entries]
  );
  /**
   * The single write path. It produces the next state, writes browser storage
   * from that same value when the store is local, and hands the caller the
   * annotation it touched so a network write can follow.
   */
  const update = useCallback(
    (mutate: (draft: Map<string, Annotation[]>) => void) => {
      setState((current) => {
        const byItemId = new Map(current.byItemId);
        mutate(byItemId);
        const next: CommentState = { byItemId, revision: current.revision + 1 };
        if (store === 'local') {
          writeStoredString(
            storageKey,
            JSON.stringify(toStoredRows(next, pathByItemId))
          );
        }
        return next;
      });
    },
    [pathByItemId, storageKey, store]
  );

  const replace = useCallback(
    (
      itemId: string,
      key: string,
      next: (metadata: CommentMetadata) => CommentMetadata | undefined
    ) => {
      update((draft) => {
        const list = draft.get(itemId);
        if (list == null) return;
        const kept: Annotation[] = [];
        for (const annotation of list) {
          if (annotation.metadata.key !== key) {
            kept.push(annotation);
            continue;
          }
          const metadata = next(annotation.metadata);
          if (metadata != null) kept.push({ ...annotation, metadata });
        }
        draft.set(itemId, kept);
      });
    },
    [update]
  );

  // Load whatever the store already holds, once the diff is parsed.
  const load = useCallback(async () => {
    if (!ready) return;

    const place = (rows: readonly StoredLocalComment[]) => {
      // Group first, so a reply lands in its root's card instead of stacking
      // as a separate annotation on the same line.
      const byItemId = new Map<string, Annotation[]>();
      const byPath = new Map<string, CommentPayload[]>();
      for (const row of rows) {
        const list = byPath.get(row.path) ?? [];
        list.push(row);
        byPath.set(row.path, list);
      }

      for (const [path, payloads] of byPath) {
        const itemId = itemIdByPath.get(path);
        // A comment on a path absent from this diff is dropped. That happens
        // after a force push rewrites the branch under the comment.
        if (itemId == null) continue;
        const annotations = byItemId.get(itemId) ?? [];
        for (const thread of groupCommentThreads(payloads)) {
          annotations.push(
            annotationFromThread(
              thread.key,
              thread.comments,
              threadComments(thread)
            )
          );
        }
        byItemId.set(itemId, annotations);
      }
      setState((current) => ({ byItemId, revision: current.revision + 1 }));
    };

    if (store === 'local') {
      place(readStoredJson<StoredLocalComment[]>(storageKey, []));
      return;
    }
    if (pullOwner == null || pullRepo == null || pullNumber == null) return;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(undefined);

    try {
      const comments = await rpc.comments.list(
        { number: pullNumber, owner: pullOwner, repo: pullRepo },
        { signal: controller.signal }
      );
      place(
        comments.map((payload) => ({
          ...payload,
          key: `github-${payload.githubId ?? nextKeyRef.current++}`,
        }))
      );
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(rpcErrorMessage(cause, 'Could not load comments.'));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [itemIdByPath, pullNumber, pullOwner, pullRepo, ready, storageKey, store]);

  useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  const startDraft = useCallback(
    (itemId: string, range: SelectedLineRange) => {
      const side = range.endSide ?? range.side;
      if (side == null) return;
      const key = `draft-${nextKeyRef.current++}`;
      update((draft) => {
        // One composer at a time: a second gutter click replaces the open one.
        for (const [id, list] of draft) {
          const kept = list.filter((item) => item.metadata.kind !== 'draft');
          if (kept.length !== list.length) draft.set(id, kept);
        }
        draft.set(itemId, [
          ...(draft.get(itemId) ?? []),
          {
            side,
            lineNumber: range.end,
            metadata: { kind: 'draft', key, draftBody: '', range },
          },
        ]);
      });
    },
    [update]
  );

  const postToGitHub = useCallback(
    async (
      itemId: string,
      key: string,
      input: {
        body: string;
        path: string;
      } & Pick<CommentPayload, 'line' | 'side' | 'startLine' | 'startSide'>
    ) => {
      if (pullOwner == null || pullRepo == null || pullNumber == null) return;
      try {
        const comment = await rpc.comments.create({
          number: pullNumber,
          owner: pullOwner,
          repo: pullRepo,
          ...input,
        });
        replace(itemId, key, (metadata) => ({
          ...metadata,
          kind: 'thread',
          range: rangeFromCommentPayload(comment),
          comments: [
            {
              key: `gh-${comment.githubId ?? key}`,
              githubId: comment.githubId,
              author: comment.author,
              authorAvatarUrl: comment.authorAvatarUrl,
              authorIsBot: comment.authorIsBot,
              body: comment.body,
              createdAt: comment.createdAt,
              htmlUrl: comment.htmlUrl,
            },
          ],
          draftBody: undefined,
          pending: false,
          error: undefined,
        }));
      } catch (cause) {
        replace(itemId, key, (metadata) => ({
          ...metadata,
          pending: false,
          error: rpcErrorMessage(
            cause,
            'Could not post that comment to GitHub.'
          ),
        }));
      }
    },
    [pullNumber, pullOwner, pullRepo, replace]
  );

  const postReply = useCallback(
    async (
      itemId: string,
      key: string,
      pendingKey: string,
      replyToId: number,
      body: string
    ) => {
      if (pullOwner == null || pullRepo == null || pullNumber == null) return;
      try {
        const comment = await rpc.comments.create({
          body,
          number: pullNumber,
          owner: pullOwner,
          repo: pullRepo,
          replyToId,
        });
        // The optimistic message becomes the real one, in place. Its position
        // is already right: GitHub sorts replies by creation time and this is
        // the newest, so the thread does not reorder under the reader.
        replace(itemId, key, (metadata) => ({
          ...metadata,
          comments: (metadata.comments ?? []).map((existing) =>
            existing.key === pendingKey
              ? {
                  key: `gh-${comment.githubId ?? pendingKey}`,
                  githubId: comment.githubId,
                  author: comment.author,
                  authorAvatarUrl: comment.authorAvatarUrl,
                  authorIsBot: comment.authorIsBot,
                  body: comment.body,
                  createdAt: comment.createdAt,
                  htmlUrl: comment.htmlUrl,
                }
              : existing
          ),
          pending: false,
          error: undefined,
        }));
      } catch (cause) {
        // The text stays in the thread, marked as failed. Throwing it away
        // would lose what the reviewer wrote.
        replace(itemId, key, (metadata) => ({
          ...metadata,
          pending: false,
          error: rpcErrorMessage(cause, 'Could not post this reply to GitHub.'),
        }));
      }
    },
    [pullNumber, pullOwner, pullRepo, replace]
  );

  const saveDraft = useCallback(
    (itemId: string, key: string, body: string) => {
      const trimmed = body.trim();
      if (trimmed.length === 0) return;

      const existing = state.byItemId
        .get(itemId)
        ?.find((annotation) => annotation.metadata.key === key);
      if (existing == null) return;
      const range = existing.metadata.range;

      // Shown at once as a thread of one, then reconciled with what GitHub
      // returns. ghdiff posts a new top-level comment; it does not reply.
      replace(itemId, key, () => ({
        kind: 'thread',
        key,
        range,
        comments: [
          {
            key: `pending-${key}`,
            author: viewerLogin ?? 'you',
            body: trimmed,
            createdAt: new Date().toISOString(),
          },
        ],
        pending: store === 'github',
      }));

      if (store !== 'github') return;
      const path = pathByItemId.get(itemId);
      if (path == null) return;
      void postToGitHub(itemId, key, {
        body: trimmed,
        path,
        ...commentPayloadRangeFields(range),
      });
    },
    [pathByItemId, postToGitHub, replace, state.byItemId, store, viewerLogin]
  );

  const replyToThread = useCallback(
    (itemId: string, key: string, body: string) => {
      const trimmed = body.trim();
      if (trimmed.length === 0) return;

      const metadata = state.byItemId
        .get(itemId)
        ?.find((annotation) => annotation.metadata.key === key)?.metadata;
      if (metadata == null || !isCommentThread(metadata)) return;

      // GitHub files a reply under the thread of the comment it answers, and
      // the root is the comment that identifies the thread. A thread whose
      // root has not reached GitHub yet cannot take a reply, so the composer
      // stays closed until the root has posted.
      const replyToId = metadata.comments[0].githubId;
      if (store === 'github' && replyToId == null) return;

      const pendingKey = `reply-${nextKeyRef.current++}`;
      replace(itemId, key, (current) => ({
        ...current,
        comments: [
          ...(current.comments ?? []),
          {
            key: pendingKey,
            author: viewerLogin ?? 'you',
            body: trimmed,
            createdAt: new Date().toISOString(),
          },
        ],
        pending: store === 'github',
        error: undefined,
      }));

      if (store !== 'github' || replyToId == null) return;
      void postReply(itemId, key, pendingKey, replyToId, trimmed);
    },
    [postReply, replace, state.byItemId, store, viewerLogin]
  );

  const removeComment = useCallback(
    (itemId: string, key: string) => {
      const metadata = state.byItemId
        .get(itemId)
        ?.find((annotation) => annotation.metadata.key === key)?.metadata;
      // Deleting a thread deletes every message ghdiff knows about it. A
      // reply left behind on GitHub would reappear as its own thread.
      const githubIds =
        metadata != null && isCommentThread(metadata)
          ? metadata.comments
              .map((comment) => comment.githubId)
              .filter((id): id is number => id != null)
          : [];

      replace(itemId, key, () => undefined);

      if (
        store !== 'github' ||
        githubIds.length === 0 ||
        pullOwner == null ||
        pullRepo == null
      ) {
        return;
      }
      const remove = async () => {
        try {
          // Newest first, because GitHub refuses to delete a comment that
          // still has replies pointing at it.
          for (const githubId of [...githubIds].reverse()) {
            await rpc.comments.remove({
              commentId: githubId,
              owner: pullOwner,
              repo: pullRepo,
            });
          }
        } catch {
          setError('Could not delete that thread on GitHub. Reload to check.');
        }
      };
      void remove();
    },
    [pullOwner, pullRepo, replace, state.byItemId, store]
  );

  const reload = useCallback(() => {
    void load();
  }, [load]);

  return {
    store,
    annotationsByItemId: state.byItemId,
    revision: state.revision,
    loading,
    error,
    startDraft,
    saveDraft,
    replyToThread,
    removeComment,
    reload,
  };
}
