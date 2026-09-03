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

// One owner for the state the whole app shares.
//
// Three of these five read a setting out of browser storage, and each of those
// three reads it through a jotai atom, so the store is the owner and two callers
// cannot come to disagree — see `src/hooks/preferences.ts`.
//
// The other two are requests to GitHub, and they are here for the opposite
// reason: mounting either twice would ask GitHub twice. `useOpenPulls` is the
// watch list's own question. `useGitHubSession` reads nothing from storage at
// all — the credential is in a cookie the browser attaches by itself — but one
// answer to "who is this" serves the account menu, the review header, and every
// screen that needs to know whose name a comment will carry.
//
// So this provider stays, and the rule with it. It is the one place the five are
// mounted, it is where the request's inputs are wired to the settings it depends
// on, and it is what carries the answer to a bar and a page that are never
// unmounted between pull requests.

export interface AppData {
  codeFont: CodeFontState;
  colorMode: ColorModeState;
  pulls: OpenPullsState;
  session: GitHubSessionState;
  watched: WatchedReposState;
}

const AppDataContext = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const codeFont = useCodeFont();
  const colorMode = useColorMode();
  const session = useGitHubSession();
  const watched = useWatchedRepos();
  const pulls = useOpenPulls({
    ready: watched.hydrated,
    repos: watched.repos,
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
    () => ({ codeFont, colorMode, pulls, session, watched }),
    [codeFont, colorMode, pulls, session, watched]
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
