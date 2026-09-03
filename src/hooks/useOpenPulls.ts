import { useCallback, useEffect, useRef, useState } from 'react';

import {
  formatWatchedRepo,
  type OpenPullsData,
  parseWatchedRepo,
  type WatchedRepo,
} from '@/lib/pulls';
import { rpc, rpcErrorMessage } from '@/lib/rpc/client';

export interface OpenPullsState {
  data?: OpenPullsData;
  loading: boolean;
  error?: string;
  reload(): void;
}

const EMPTY_DATA: OpenPullsData = { pulls: [], failures: [] };

/** The watch list back out of the joined key the hook depends on. */
function reposFromKey(key: string): WatchedRepo[] {
  return key
    .split(',')
    .map((entry) => parseWatchedRepo(entry))
    .filter((entry): entry is WatchedRepo => entry != null);
}

/**
 * The open pull requests of the watched repositories. The left bar is on every
 * page, so this runs for the whole session and one instance feeds every list.
 *
 * `ready` holds the first request back until the watch list has been read out of
 * storage. Without it the app asks GitHub about no repositories at all, and then
 * asks again a tick later. The credential needs no such wait: it is in a cookie
 * the browser attaches itself.
 */
export function useOpenPulls(options: {
  ready: boolean;
  repos: readonly WatchedRepo[];
}): OpenPullsState {
  const { ready, repos } = options;
  const [data, setData] = useState<OpenPullsData | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // One request at a time. A reload, or a change of repositories, cancels the
  // request in flight so a slow answer cannot overwrite a newer one.
  const controllerRef = useRef<AbortController | null>(null);

  // The watch list travels as one comma-joined string and the request is built
  // back out of it. The array's identity changes on every render of whatever
  // owns it, and a `useCallback` that depended on the array would rebuild, and
  // re-request, each time. The string compares by value.
  const repoKey = repos.map(formatWatchedRepo).join(',');

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(undefined);

    try {
      setData(
        await rpc.pulls.list(
          { repos: reposFromKey(repoKey) },
          { signal: controller.signal }
        )
      );
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(rpcErrorMessage(cause, 'Could not load pull requests.'));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [repoKey]);

  useEffect(() => {
    if (!ready) return undefined;
    if (repoKey.length === 0) {
      setData(EMPTY_DATA);
      setError(undefined);
      return undefined;
    }
    void load();
    return () => {
      controllerRef.current?.abort();
      // `load` leaves `loading` alone when its request is aborted, because the
      // request that aborted it owns the flag from then on. Nothing follows
      // this abort, so the flag is cleared here. Otherwise it stayed true for
      // good, and the indicator beside the list turned for ever.
      setLoading(false);
    };
  }, [load, ready, repoKey]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  // Before the first answer arrives there is nothing on screen yet, and a list
  // that says "empty" is wrong. `loading` covers the wait either way.
  return { data, loading: loading || !ready, error, reload };
}
