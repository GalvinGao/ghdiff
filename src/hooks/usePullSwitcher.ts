import { useCallback, useEffect, useRef, useState } from 'react';

import { withGitHubToken } from './useGitHubToken';
import {
  formatWatchedRepo,
  type PullSwitcherData,
  type WatchedRepo,
} from '@/lib/pullSwitcher';

export interface PullSwitcherState {
  data?: PullSwitcherData;
  loading: boolean;
  error?: string;
  reload(): void;
}

const EMPTY_DATA: PullSwitcherData = { groups: [], failures: [] };

/**
 * Loads open pull requests for the watched repositories. It runs only while the
 * switcher is open, so opening the app costs no GitHub requests.
 */
export function usePullSwitcher(options: {
  active: boolean;
  repos: readonly WatchedRepo[];
  token?: string;
}): PullSwitcherState {
  const { active, repos, token } = options;
  const [data, setData] = useState<PullSwitcherData | undefined>(undefined);
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
      setData((await response.json()) as PullSwitcherData);
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
    if (!active) return undefined;
    if (repoKey.length === 0) {
      setData(EMPTY_DATA);
      setError(undefined);
      return undefined;
    }
    void load();
    return () => controllerRef.current?.abort();
  }, [active, load, repoKey]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload };
}
