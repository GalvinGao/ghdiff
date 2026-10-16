import { getRouteApi } from '@tanstack/react-router';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from 'react';

import { type CodeFontState, useCodeFont } from '@/hooks/useCodeFont';
import { type ColorModeState, useColorMode } from '@/hooks/useColorMode';
import {
  type GitHubSessionState,
  useGitHubSession,
} from '@/hooks/useGitHubSession';
import { type OpenPullsState, useOpenPulls } from '@/hooks/useOpenPulls';
import {
  useWatchedRepos,
  type WatchedReposState,
} from '@/hooks/useWatchedRepos';
import { gitLabHostNames } from '@/lib/forges';
import type { InstanceLoaderData } from '@/lib/instance';

const rootRoute = getRouteApi('__root__');

// One owner for the state the whole app shares.
//
// Three of these six read a setting out of browser storage, and each of those
// three reads it through a jotai atom, so the store is the owner and two callers
// cannot come to disagree — see `src/hooks/preferences.ts`.
//
// Two more are requests, and they are here for the opposite reason: mounting
// either of them twice would ask twice. `useOpenPulls` is the watch list's own
// question. `useGitHubSession` reads nothing from storage at all — the
// credential is in a cookie the browser attaches by itself — but one answer to
// "who is this" serves the account menu, the review header, and every screen
// that needs to know whose name a comment will carry. The last is no request
// at all: what this deployment serves arrives with the page in the root
// route's loader data, which is what the home page's box validates against
// and the parse behind the watch list reads.
//
// So this provider stays, and the rule with it. It is the one place the six are
// mounted, it is where the request's inputs are wired to the settings it depends
// on, and it is what carries the answer to a bar and a page that are never
// unmounted between pull requests.

export interface AppData {
  codeFont: CodeFontState;
  colorMode: ColorModeState;
  instance: InstanceLoaderData;
  pulls: OpenPullsState;
  session: GitHubSessionState;
  watched: WatchedReposState;
}

/**
 * Exported for one caller that is not a screen: the `ghdiff` command's own
 * client, which serves a diff off a disk and talks to GitHub not at all. It
 * mounts the two settings hooks and supplies the three GitHub-shaped fields
 * inert, so nothing under it ever issues a request this app's local server has
 * no answer for. Every screen goes on reading `useAppData()`.
 */
export const AppDataContext = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const codeFont = useCodeFont();
  const colorMode = useColorMode();
  const instance = rootRoute.useLoaderData();
  const session = useGitHubSession();
  // One array per answer, so the hooks below hold a stable dependency.
  const gitlabHosts = useMemo(() => gitLabHostNames(instance), [instance]);
  const watched = useWatchedRepos({ gitlabHosts });
  const pulls = useOpenPulls({
    ready: watched.hydrated,
    repos: watched.repos,
    gitlabHosts,
  });

  // The document's own answer to whether the left bar is there.
  // `WatchedReposScript` writes it before the first paint and `globals.css`
  // hides the bar on 'no', and from then on it belongs to the watch list. A
  // reviewer who watches their first repository is exactly the reader that rule
  // was hiding the bar from, and a stale 'no' goes on hiding it until the next
  // load. The read of storage is what settles the attribute, so nothing is
  // written before `hydrated`.
  const watching = watched.hydrated ? watched.repos.length > 0 : undefined;
  useEffect(() => {
    if (watching == null) return;
    document.documentElement.dataset.watching = watching ? 'yes' : 'no';
  }, [watching]);

  const value = useMemo<AppData>(
    () => ({ codeFont, colorMode, instance, pulls, session, watched }),
    [codeFont, colorMode, instance, pulls, session, watched]
  );

  return (
    <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
  );
}

export function useAppData(): AppData {
  const value = useContext(AppDataContext);
  if (value == null) {
    throw new Error('useAppData must be called inside an AppDataProvider');
  }
  return value;
}
