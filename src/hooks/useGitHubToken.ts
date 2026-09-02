import { useCallback, useEffect, useState } from 'react';

import { gitHubTokenPreference, usePreference } from './preferences';
import { rpc, rpcErrorMessage } from '@/lib/rpc/client';
import type { GitHubViewer } from '@/lib/viewer';

export type { GitHubViewer };

export interface GitHubTokenState {
  token?: string;
  hasToken: boolean;
  viewer?: GitHubViewer;
  viewerError?: string;
  checking: boolean;
  hydrated: boolean;
  setToken(token: string): void;
  clearToken(): void;
}

/**
 * Holds the personal access token in local storage, never on the server, and
 * resolves the login it belongs to so the pull switcher knows which pull
 * requests are self review.
 *
 * The token is one of the app's settings, so a reviewer who signs in on one tab
 * is signed in on the others: the storage event carries the new token over and
 * the check below re-runs there on its own.
 */
export function useGitHubToken(): GitHubTokenState {
  const {
    value: stored,
    hydrated,
    setValue: storeToken,
  } = usePreference(gitHubTokenPreference);
  const token = stored ?? undefined;
  const [viewer, setViewer] = useState<GitHubViewer | undefined>(undefined);
  const [viewerError, setViewerError] = useState<string | undefined>(undefined);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!hydrated) return undefined;
    if (token == null) {
      setViewer(undefined);
      setViewerError(undefined);
      return undefined;
    }

    const controller = new AbortController();
    setChecking(true);

    const check = async () => {
      try {
        const result = await rpc.viewer.get(undefined, {
          context: { token },
          signal: controller.signal,
        });
        setViewer(result.viewer);
        setViewerError(undefined);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setViewer(undefined);
        setViewerError(rpcErrorMessage(cause, 'Could not verify this token.'));
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    };

    void check();
    return () => controller.abort();
  }, [hydrated, token]);

  const setToken = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      storeToken(trimmed.length === 0 ? null : trimmed);
    },
    [storeToken]
  );

  // `null` removes the key rather than writing an empty string, so signing out
  // leaves nothing behind for the next reader to trim.
  const clearToken = useCallback(() => storeToken(null), [storeToken]);

  return {
    token,
    hasToken: token != null,
    viewer,
    viewerError,
    checking,
    hydrated,
    setToken,
    clearToken,
  };
}

/**
 * Adds the token to a fetch, when there is one. Only `useReviewPatch` needs
 * this now: every other call goes through the RPC client, which puts the token
 * on the header itself.
 */
export function withGitHubToken(
  token: string | undefined,
  init?: RequestInit
): RequestInit {
  if (token == null) return { cache: 'no-store', ...init };
  return {
    cache: 'no-store',
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${token}` },
  };
}
