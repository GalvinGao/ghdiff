'use client';

import type { DiffLineAnnotation, SelectedLineRange } from '@pierre/diffs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { withGitHubToken } from './useGitHubToken';
import { readStoredJson, writeStoredString } from './useLocalStorage';
import {
  commentPayloadRangeFields,
  type CommentMetadata,
  type CommentPayload,
  isSavedComment,
  rangeFromCommentPayload,
} from '@/lib/comments';
import type { ReviewFileEntry } from '@/lib/reviewData';
import {
  type ReviewTarget,
  reviewTargetKey,
  supportsGitHubComments,
} from '@/lib/reviewTarget';
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
  /** Removes a draft, or deletes a saved comment from its store. */
  removeComment(itemId: string, key: string): void;
  reload(): void;
}

interface StoredLocalComment extends CommentPayload {
  key: string;
}

function annotationFromPayload(
  payload: CommentPayload,
  key: string
): Annotation {
  return {
    side: payload.side,
    lineNumber: payload.line,
    metadata: {
      kind: 'saved',
      key,
      githubId: payload.githubId,
      author: payload.author,
      authorAvatarUrl: payload.authorAvatarUrl,
      body: payload.body,
      range: rangeFromCommentPayload(payload),
      createdAt: payload.createdAt,
      htmlUrl: payload.htmlUrl,
    },
  };
}

/** Flattens saved comments back into the browser-storage row shape. */
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
      if (!isSavedComment(metadata)) continue;
      rows.push({
        key: metadata.key,
        path,
        author: metadata.author,
        body: metadata.body,
        createdAt: metadata.createdAt,
        ...commentPayloadRangeFields(metadata.range),
      });
    }
  }
  return rows;
}

export function useReviewComments(options: {
  target: ReviewTarget;
  entries: readonly ReviewFileEntry[];
  token?: string;
  viewerLogin?: string;
  /** True once the diff is parsed. Comments only map onto known files. */
  ready: boolean;
}): ReviewCommentsState {
  const { entries, ready, target, token, viewerLogin } = options;
  const store: CommentStore = supportsGitHubComments(target)
    ? 'github'
    : 'local';

  // `target` arrives from a server component, so its object identity changes
  // whenever the RSC payload is read again. Every loader below depends on these
  // derived strings instead, which compare by value.
  const storageKey = localCommentsStorageKey(reviewTargetKey(target));
  const pullQuery =
    target.kind === 'github-pull'
      ? new URLSearchParams({
          owner: target.owner,
          repo: target.repo,
          number: String(target.number),
        }).toString()
      : undefined;
  const pullRepo =
    target.kind === 'github-pull'
      ? `${target.owner}/${target.repo}`
      : undefined;

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
      const byItemId = new Map<string, Annotation[]>();
      for (const row of rows) {
        const itemId = itemIdByPath.get(row.path);
        // A comment on a path absent from this diff is dropped. That happens
        // after a force push rewrites the branch under the comment.
        if (itemId == null) continue;
        const list = byItemId.get(itemId) ?? [];
        list.push(annotationFromPayload(row, row.key));
        byItemId.set(itemId, list);
      }
      setState((current) => ({ byItemId, revision: current.revision + 1 }));
    };

    if (store === 'local') {
      place(readStoredJson<StoredLocalComment[]>(storageKey, []));
      return;
    }
    if (pullQuery == null) return;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(undefined);

    try {
      const response = await fetch(
        `/api/comments?${pullQuery}`,
        withGitHubToken(token, { signal: controller.signal })
      );
      const body = (await response.json()) as {
        comments?: CommentPayload[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? `Request failed (${response.status}).`);
      }
      place(
        (body.comments ?? []).map((payload) => ({
          ...payload,
          key: `github-${payload.githubId ?? nextKeyRef.current++}`,
        }))
      );
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(
        cause instanceof Error ? cause.message : 'Could not load comments.'
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [itemIdByPath, pullQuery, ready, storageKey, store, token]);

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
            metadata: { kind: 'draft', key, body: '', range },
          },
        ]);
      });
    },
    [update]
  );

  const postToGitHub = useCallback(
    async (itemId: string, key: string, body: string) => {
      if (pullQuery == null) return;
      try {
        const response = await fetch(
          `/api/comments?${pullQuery}`,
          withGitHubToken(token, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          })
        );
        const payload = (await response.json()) as {
          comment?: CommentPayload;
          error?: string;
        };
        if (!response.ok || payload.comment == null) {
          throw new Error(
            payload.error ?? `GitHub rejected the comment (${response.status}).`
          );
        }
        const comment = payload.comment;
        replace(itemId, key, (metadata) => ({
          ...metadata,
          kind: 'saved',
          author: comment.author,
          authorAvatarUrl: comment.authorAvatarUrl,
          body: comment.body,
          range: rangeFromCommentPayload(comment),
          githubId: comment.githubId,
          createdAt: comment.createdAt,
          htmlUrl: comment.htmlUrl,
          pending: false,
          error: undefined,
        }));
      } catch (cause) {
        replace(itemId, key, (metadata) => ({
          ...metadata,
          pending: false,
          error:
            cause instanceof Error
              ? cause.message
              : 'Could not post that comment to GitHub.',
        }));
      }
    },
    [pullQuery, replace, token]
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

      replace(itemId, key, () => ({
        kind: 'saved',
        key,
        author: viewerLogin ?? 'you',
        body: trimmed,
        range,
        createdAt: new Date().toISOString(),
        pending: store === 'github',
      }));

      if (store !== 'github') return;
      const path = pathByItemId.get(itemId);
      if (path == null) return;
      void postToGitHub(
        itemId,
        key,
        JSON.stringify({
          body: trimmed,
          path,
          ...commentPayloadRangeFields(range),
        })
      );
    },
    [pathByItemId, postToGitHub, replace, state.byItemId, store, viewerLogin]
  );

  const removeComment = useCallback(
    (itemId: string, key: string) => {
      const metadata = state.byItemId
        .get(itemId)
        ?.find((annotation) => annotation.metadata.key === key)?.metadata;
      const githubId =
        metadata != null && isSavedComment(metadata)
          ? metadata.githubId
          : undefined;

      replace(itemId, key, () => undefined);

      if (store !== 'github' || githubId == null || pullRepo == null) return;
      const [owner, repo] = pullRepo.split('/');
      const query = new URLSearchParams({
        owner,
        repo,
        commentId: String(githubId),
      });
      const remove = async () => {
        try {
          const response = await fetch(
            `/api/comments?${query.toString()}`,
            withGitHubToken(token, { method: 'DELETE' })
          );
          if (!response.ok) {
            throw new Error(`GitHub refused the delete (${response.status}).`);
          }
        } catch {
          setError('Could not delete that comment on GitHub. Reload to check.');
        }
      };
      void remove();
    },
    [pullRepo, replace, state.byItemId, store, token]
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
    removeComment,
    reload,
  };
}
