import { useCallback, useEffect, useRef, useState } from 'react';

import { withGitHubToken } from './useGitHubToken';
import {
  formatWatchedRepo,
  type OpenPullsData,
  type WatchedRepo,
} from '@/lib/pulls';

export interface OpenPullsState {
  data?: OpenPullsData;
  loading: boolean;
  error?: string;
  reload(): void;
}

const EMPTY_DATA: OpenPullsData = { pulls: [], failures: [] };

/**
 * The open pull requests of the watched repositories. The left bar is on every
 * page, so this runs for the whole session and one instance feeds every list.
 *
 * `ready` holds the first request back until the browser has read the token and
 * the watch list out of storage. Without it the app asks GitHub anonymously,
 * gets an unauthenticated answer with no review or check state, and then asks
 * again a tick later.
 */
export function useOpenPulls(options: {
  ready: boolean;
  repos: readonly WatchedRepo[];
  token?: string;
}): OpenPullsState {
  const { ready, repos, token } = options;
  const [data, setData] = useState<OpenPullsData | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // One request at a time. A reload, or a change of repositories, cancels the
  // request in flight so a slow answer cannot overwrite a newer one.
  const controllerRef = useRef<AbortController | null>(null);

  const repoKey = repos.map(formatWatchedRepo).join(',');

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(undefined);

    try {
      const response = await fetch(
        `/api/github/pulls?repos=${encodeURIComponent(repoKey)}`,
        withGitHubToken(token, { signal: controller.signal })
      );
      if (!response.ok) {
        throw new Error(`GitHub request failed (${response.status}).`);
      }
      setData((await response.json()) as OpenPullsData);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(
        cause instanceof Error ? cause.message : 'Could not load pull requests.'
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [repoKey, token]);

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
