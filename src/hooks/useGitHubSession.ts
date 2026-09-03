import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';

import { AUTH_ERROR_PARAM, authFailureMessage } from '@/lib/githubApp';
import { heldLegacyToken } from '@/lib/legacyToken';
import { rpc, rpcErrorMessage } from '@/lib/rpc/client';
import { LEGACY_GITHUB_TOKEN_STORAGE_KEY } from '@/lib/storageKeys';
import type { GitHubViewer } from '@/lib/viewer';

export type { GitHubViewer };

export interface GitHubSessionState {
  /** Whether this browser's requests reach GitHub as somebody. */
  signedIn: boolean;
  /**
   * Whether a sign-out is a thing to offer. A deployment running on
   * `GITHUB_TOKEN` has a viewer and nothing to sign out of.
   */
  canSignOut: boolean;
  viewer?: GitHubViewer;
  /** What went wrong while asking GitHub who this is. */
  viewerError?: string;
  /** What went wrong during a sign-in that has just come back. */
  authError?: string;
  checking: boolean;
  signIn(): void;
  signOut(): void;
}

/**
 * Who this browser is signed in as.
 *
 * There is no token here and nothing read out of browser storage, which is what
 * makes this so much smaller than the hook it replaces. The credential is in a
 * sealed cookie the browser attaches to every same-origin request by itself, so
 * a screen has nothing to pass down and no hydration to wait for — one call to
 * `viewer.get` answers the only question left, which is whose name the comments
 * will carry.
 *
 * Neither press stays on this page. A sign-in has to leave the site, and a
 * sign-out is the one moment when everything already fetched under a credential
 * should stop being on screen — so it lands on the home page rather than
 * re-render a private diff into an error panel. That is also why nothing here
 * has a version counter: no hook needs telling to re-run when the whole document
 * is about to be replaced.
 */
export function useGitHubSession(): GitHubSessionState {
  const [viewer, setViewer] = useState<GitHubViewer | undefined>(undefined);
  const [canSignOut, setCanSignOut] = useState(false);
  const [viewerError, setViewerError] = useState<string | undefined>(undefined);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState<string | undefined>(undefined);
  const navigate = useNavigate();

  useEffect(() => {
    const controller = new AbortController();
    const check = async () => {
      try {
        const result = await rpc.viewer.get(undefined, {
          signal: controller.signal,
        });
        setViewer(result.viewer);
        setCanSignOut(result.fromSession === true);
        setViewerError(undefined);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setViewer(undefined);
        setCanSignOut(false);
        setViewerError(
          rpcErrorMessage(cause, 'Could not check who you are signed in as.')
        );
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    };

    void check();
    return () => controller.abort();
  }, []);

  // A failed sign-in has nowhere to draw a panel — the callback is a redirect —
  // so the reason arrives on the address instead. It is read once and taken back
  // out, or it would say the same thing again on every reload of a page the
  // reviewer has since signed in on. `replaceState` and not the router: nothing
  // in this app routes on this parameter, and a navigation is not what the
  // reviewer asked for.
  useEffect(() => {
    const url = new URL(window.location.href);
    const message = authFailureMessage(url.searchParams.get(AUTH_ERROR_PARAM));
    if (message == null) return;
    setAuthError(message);
    url.searchParams.delete(AUTH_ERROR_PARAM);
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`
    );
  }, []);

  // A personal access token an older build of ghdiff left in this browser.
  //
  // It is not honoured for a release first, which was the other plan. The header
  // beats the cookie in `resolveGitHubToken`, deliberately, so a browser still
  // sending an old token would go on using it after the reviewer had signed in —
  // and they would have no way to tell which account their comments carried.
  //
  // So it goes. But not quietly: it is still a live credential at GitHub, and
  // deleting it from storage revokes nothing. A reviewer who is never told it was
  // there will leave it valid for the rest of its ninety days. `/setup` is where
  // that gets said, and this is the one redirect in the app nobody asked for.
  //
  // Which is why the gate is `heldLegacyToken` and nothing else. ghdiff works
  // signed out, and an anonymous visitor pulled off the diff they asked for would
  // be a plain regression — so a browser with no key, an empty key, or storage
  // that throws goes nowhere at all. See `@/lib/legacyToken`.
  useEffect(() => {
    let held = false;
    try {
      held = heldLegacyToken(
        window.localStorage.getItem(LEGACY_GITHUB_TOKEN_STORAGE_KEY)
      );
      // Removed before the navigation, so a reviewer who presses back arrives at
      // a browser with nothing left to migrate and is not sent here twice.
      if (held) {
        window.localStorage.removeItem(LEGACY_GITHUB_TOKEN_STORAGE_KEY);
      }
    } catch {
      // Storage is refused, so nothing was held and nothing is claimed.
      return;
    }
    if (!held) return;

    // Read off `window` rather than through `useLocation`, so this effect keeps
    // its empty dependency list and stays the one-shot it has to be.
    const { hash, pathname, search } = window.location;
    if (pathname === '/setup') return;
    void navigate({
      search: {
        account: undefined,
        from: `${pathname}${search}${hash}`,
        migrated: true,
      },
      to: '/setup',
    });
  }, [navigate]);

  const signIn = useCallback(() => {
    // Where to come back to, and the fragment is the half worth keeping: it
    // names the file and the lines the reviewer was reading, and it is the one
    // part of an address the browser never sends to a server.
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(
      `/api/auth/start?returnTo=${encodeURIComponent(returnTo)}`
    );
  }, []);

  const signOut = useCallback(() => {
    const leave = async () => {
      try {
        await fetch('/api/auth/signout', { method: 'POST' });
      } catch {
        // The cookie is gone or it is not, and either way the reviewer asked to
        // leave. Landing them on the home page is the answer to both.
      }
      window.location.assign('/');
    };
    void leave();
  }, []);

  return {
    signedIn: viewer != null,
    canSignOut,
    viewer,
    viewerError,
    authError,
    checking,
    signIn,
    signOut,
  };
}
