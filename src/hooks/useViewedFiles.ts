import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { readStoredJson, writeStoredString } from './useLocalStorage';
import type { ReviewFileEntry } from '@/lib/reviewData';
import { type ReviewTarget, reviewTargetKey } from '@/lib/reviewTarget';
import { rpc, rpcErrorMessage } from '@/lib/rpc/client';
import { localViewedFilesStorageKey } from '@/lib/storageKeys';

// Which files the reviewer has already read, and where that fact is kept.
//
// A pull request is the one target GitHub holds this for, so a mark made on
// one goes to github.com and comes back on the reviewer's next visit, from
// this app or from GitHub's own screen. A commit and a compare range have no
// such state upstream, so their marks stay in this browser — the same split
// `useReviewComments` already makes, for the same reason.

export type ViewedFilesStore = 'github' | 'local';

const NO_FILES: ReadonlySet<string> = new Set<string>();

export interface ViewedFilesState {
  /** Where a mark made here goes. */
  store: ViewedFilesStore;
  /** The files marked read, by item id. */
  viewed: ReadonlySet<string>;
  /**
   * The marks as the store last reported them, and a new object on every read
   * of it. The screen folds the files this names, which is why it cannot be
   * `viewed`: that one moves on every press, and folding again on a press
   * would shut a file the reviewer had just opened by hand.
   */
  loaded: ReadonlySet<string>;
  setViewed(itemId: string, viewed: boolean): void;
  error?: string;
  dismissError(): void;
}

export function useViewedFiles(options: {
  target: ReviewTarget;
  entries: readonly ReviewFileEntry[];
  token?: string;
  /** True once the diff is parsed. A mark only means something on a file. */
  ready: boolean;
}): ViewedFilesState {
  const { entries, ready, target, token } = options;

  // The target arrives from a loader, so its object identity changes on every
  // re-run of that loader. Everything below depends on these derived values
  // instead, which compare by value.
  const storageKey = localViewedFilesStorageKey(reviewTargetKey(target));
  const pullOwner = target.kind === 'github-pull' ? target.owner : undefined;
  const pullRepo = target.kind === 'github-pull' ? target.repo : undefined;
  const pullNumber = target.kind === 'github-pull' ? target.number : undefined;
  const store: ViewedFilesStore = pullNumber == null ? 'local' : 'github';

  const [viewed, setViewedFiles] = useState<ReadonlySet<string>>(NO_FILES);
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(NO_FILES);
  const [error, setError] = useState<string | undefined>(undefined);
  // One load at a time. A new target, or a new token, cancels the request in
  // flight so a slow answer cannot overwrite a newer one.
  const controllerRef = useRef<AbortController | null>(null);

  // GitHub names a file by its path; this app names it by its item id, which
  // carries a commit prefix when one patch file holds several commits. Both
  // directions are needed: one to read GitHub's answer in, one to write a
  // press out with.
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

  const load = useCallback(async () => {
    if (!ready) return;

    if (store === 'local') {
      const stored = new Set(readStoredJson<string[]>(storageKey, []));
      setViewedFiles(stored);
      setLoaded(stored);
      return;
    }
    if (pullOwner == null || pullRepo == null || pullNumber == null) return;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    // Empty first, so the marks of the pull request being left cannot sit on
    // the file headers of the one arriving. A fresh set and not `NO_FILES`,
    // because the screen watches this value's identity to know a read landed.
    setViewedFiles(NO_FILES);
    setLoaded(new Set());

    try {
      const answer = await rpc.viewedFiles.list(
        { number: pullNumber, owner: pullOwner, repo: pullRepo },
        { context: { token }, signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      const next = new Set<string>();
      for (const path of answer.paths) {
        const itemId = itemIdByPath.get(path);
        // A mark on a path this diff does not hold is dropped, the way a
        // comment on one is. GitHub keeps the mark; this screen cannot show it.
        if (itemId != null) next.add(itemId);
      }
      setViewedFiles(next);
      setLoaded(next);
    } catch {
      // Nothing to say here. This is one extra fact about a pull request whose
      // diff is the screen, so a failure leaves every box empty — which is what
      // the boxes would have said for a reviewer who has read nothing — and a
      // press still reaches GitHub, because a press names only a path.
    }
  }, [
    itemIdByPath,
    pullNumber,
    pullOwner,
    pullRepo,
    ready,
    storageKey,
    store,
    token,
  ]);

  useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  const setViewed = useCallback(
    (itemId: string, next: boolean) => {
      // The box answers the press, and GitHub is told afterwards. A mark is
      // the reviewer's own bookkeeping as they read down a diff, so a tick
      // that waited on a round trip would be a tick in the way.
      setViewedFiles((current) => {
        const updated = new Set(current);
        if (next) updated.add(itemId);
        else updated.delete(itemId);
        if (store === 'local') {
          writeStoredString(storageKey, JSON.stringify([...updated]));
        }
        return updated;
      });
      if (store === 'local') return;

      const path = pathByItemId.get(itemId);
      if (
        path == null ||
        pullOwner == null ||
        pullRepo == null ||
        pullNumber == null
      ) {
        return;
      }

      void (async () => {
        try {
          await rpc.viewedFiles.set(
            {
              number: pullNumber,
              owner: pullOwner,
              path,
              repo: pullRepo,
              viewed: next,
            },
            { context: { token } }
          );
        } catch (cause) {
          // Put the box back. GitHub is the record for a pull request, and a
          // tick it did not take is a tick this app must not go on drawing —
          // the reviewer would come back tomorrow to a file they never read.
          setViewedFiles((current) => {
            const reverted = new Set(current);
            if (next) reverted.delete(itemId);
            else reverted.add(itemId);
            return reverted;
          });
          setError(
            rpcErrorMessage(cause, 'Could not send that mark to GitHub.')
          );
        }
      })();
    },
    [pathByItemId, pullNumber, pullOwner, pullRepo, storageKey, store, token]
  );

  const dismissError = useCallback(() => setError(undefined), []);

  return { dismissError, error, loaded, setViewed, store, viewed };
}
