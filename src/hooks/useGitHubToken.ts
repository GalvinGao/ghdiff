import { useCallback, useEffect, useState } from 'react';

import { readStoredString, writeStoredString } from './useLocalStorage';
import { GITHUB_TOKEN_STORAGE_KEY } from '@/lib/storageKeys';

export interface GitHubViewer {
  login: string;
  avatarUrl?: string;
  name?: string | null;
}

export interface GitHubTokenState {
  token?: string;
  hasToken: boolean;
  /** Increases on every change, so loaders re-run when the token changes. */
  version: number;
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
 */
export function useGitHubToken(): GitHubTokenState {
  const [token, setTokenState] = useState<string | undefined>(undefined);
  const [version, setVersion] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [viewer, setViewer] = useState<GitHubViewer | undefined>(undefined);
  const [viewerError, setViewerError] = useState<string | undefined>(undefined);
  const [checking, setChecking] = useState(false);

  // Read after mount, not during the first render, so the server markup and
  // the first client render agree.
  useEffect(() => {
    const stored = readStoredString(GITHUB_TOKEN_STORAGE_KEY)?.trim();
    setTokenState(stored != null && stored.length > 0 ? stored : undefined);
    setHydrated(true);
  }, []);

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
        const response = await fetch('/api/github/viewer', {
          cache: 'no-store',
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const body = (await response.json()) as {
          viewer: GitHubViewer | null;
          error?: string;
        };
        setViewer(body.viewer ?? undefined);
        setViewerError(body.error);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setViewer(undefined);
        setViewerError(
          cause instanceof Error ? cause.message : 'Could not check that token.'
        );
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    };

    void check();
    return () => controller.abort();
  }, [hydrated, token]);

  const setToken = useCallback((next: string) => {
    const trimmed = next.trim();
    setTokenState(trimmed.length === 0 ? undefined : trimmed);
    writeStoredString(
      GITHUB_TOKEN_STORAGE_KEY,
      trimmed.length === 0 ? null : trimmed
    );
    setVersion((current) => current + 1);
  }, []);

  const clearToken = useCallback(() => {
    setTokenState(undefined);
    writeStoredString(GITHUB_TOKEN_STORAGE_KEY, null);
    setVersion((current) => current + 1);
  }, []);

  return {
    token,
    hasToken: token != null,
    version,
    viewer,
    viewerError,
    checking,
    hydrated,
    setToken,
    clearToken,
  };
}

/** Adds the token to a fetch, when there is one. */
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
