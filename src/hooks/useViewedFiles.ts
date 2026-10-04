import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { m } from '../paraglide/messages.js';
import { readStoredJson, writeStoredString } from './useLocalStorage';
import { useSharedCache, useSharedQuery } from './useSharedQuery';
import type { ReviewFileEntry } from '@/lib/reviewData';
import { type ReviewTarget, reviewTargetKey } from '@/lib/reviewTarget';
import { rpc, rpcErrorMessage } from '@/lib/rpc/client';
import { localViewedFilesStorageKey } from '@/lib/storageKeys';
import type { ViewedFilesData } from '@/lib/viewedFiles';

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
  /** True once the diff is parsed. A mark only means something on a file. */
  ready: boolean;
}): ViewedFilesState {
  const { entries, ready, target } = options;

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

  // A pull request's marks are a shared query, carried to every other tab on
  // the same pull request when one of them presses. They are not kept on disk:
  // the first answer for a diff decides which files start folded, and a mark
  // GitHub has since dismissed would fold a file nobody has read again.
  const queryKey = ['viewedFiles.list', pullOwner, pullRepo, pullNumber];
  const listHash = JSON.stringify(queryKey);
  const query = useSharedQuery<ViewedFilesData>({
    queryKey,
    fetch: (signal) => {
      if (pullOwner == null || pullRepo == null || pullNumber == null) {
        throw new Error('No pull request to ask about.');
      }
      return rpc.viewedFiles.list(
        { number: pullNumber, owner: pullOwner, repo: pullRepo },
        { signal }
      );
    },
    enabled: ready && store === 'github',
  });
  const shared = useSharedCache();
  const { refetch } = query;
  const paths = query.data?.paths;

  // Presses GitHub has not answered yet, by item id. An answer that lands in
  // the meantime — another tab's press, or this tab's own earlier one — is
  // drawn with these laid over it, so a box the reviewer has just ticked does
  // not untick itself while its own request is still out.
  const inFlightRef = useRef(new Map<string, boolean>());
  // The target and the diff the marks were last seeded for. `loaded` is what
  // the screen folds from, so it changes once per diff and not once per
  // answer: a later answer — a fetch behind one read from disk, a press in
  // another tab — moves the boxes, and leaves every fold the reviewer set.
  const seededRef = useRef<{
    list: string;
    itemIdByPath: ReadonlyMap<string, string>;
    answered: boolean;
  } | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (store === 'local') {
      const stored = new Set(readStoredJson<string[]>(storageKey, []));
      setViewedFiles(stored);
      setLoaded(stored);
      return;
    }
    const seed = seededRef.current;
    const sameDiff =
      seed != null &&
      seed.list === listHash &&
      seed.itemIdByPath === itemIdByPath;
    if (paths == null) {
      // Empty first, so the marks of the pull request being left cannot sit
      // on the file headers of the one arriving. A fresh set and not
      // `NO_FILES`, because the screen watches this value's identity to know
      // a read landed. A failed read leaves it so: every box empty is what
      // the boxes would say for a reviewer who has read nothing, and a press
      // still reaches GitHub, because a press names only a path.
      if (!sameDiff) {
        inFlightRef.current.clear();
        setViewedFiles(NO_FILES);
        setLoaded(new Set());
        seededRef.current = { list: listHash, itemIdByPath, answered: false };
      }
      return;
    }
    const next = new Set<string>();
    for (const path of paths) {
      const itemId = itemIdByPath.get(path);
      // A mark on a path this diff does not hold is dropped, the way a
      // comment on one is. GitHub keeps the mark; this screen cannot show it.
      if (itemId != null) next.add(itemId);
    }
    for (const [itemId, marked] of inFlightRef.current) {
      if (marked) next.add(itemId);
      else next.delete(itemId);
    }
    setViewedFiles(next);
    if (!sameDiff || !seed.answered) {
      setLoaded(next);
      seededRef.current = { list: listHash, itemIdByPath, answered: true };
    }
  }, [itemIdByPath, listHash, paths, ready, storageKey, store]);

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

      inFlightRef.current.set(itemId, next);
      void (async () => {
        try {
          await rpc.viewedFiles.set({
            number: pullNumber,
            owner: pullOwner,
            path,
            repo: pullRepo,
            viewed: next,
          });
          // GitHub took it, and GitHub's list is the one every tab reads, so
          // the list is asked for again rather than patched here: two tabs
          // patching the same old list at once would each erase the other's
          // mark. The press stays laid over the boxes until the answer lands.
          shared?.forceNext(JSON.parse(listHash) as readonly unknown[]);
          await refetch();
          inFlightRef.current.delete(itemId);
        } catch (cause) {
          inFlightRef.current.delete(itemId);
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
            rpcErrorMessage(
              cause,
              m.use_viewed_files_could_not_send_that_mark_to_github()
            )
          );
        }
      })();
    },
    [
      listHash,
      pathByItemId,
      pullNumber,
      pullOwner,
      pullRepo,
      refetch,
      shared,
      storageKey,
      store,
    ]
  );

  const dismissError = useCallback(() => setError(undefined), []);

  return { dismissError, error, loaded, setViewed, store, viewed };
}
