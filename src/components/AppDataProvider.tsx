import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from 'react';

import { type CodeFontState, useCodeFont } from '@/hooks/useCodeFont';
import { type ColorModeState, useColorMode } from '@/hooks/useColorMode';
import { type GitHubTokenState, useGitHubToken } from '@/hooks/useGitHubToken';
import { type OpenPullsState, useOpenPulls } from '@/hooks/useOpenPulls';
import {
  useWatchedRepos,
  type WatchedReposState,
} from '@/hooks/useWatchedRepos';

// One owner for the state the whole app shares.
//
// Four of these five read a setting out of browser storage, and each of those
// four reads it through a jotai atom, so the store is the owner and two callers
// cannot come to disagree — see `src/hooks/preferences.ts`. `useOpenPulls` is
// the one that has no atom behind it: it is a request to GitHub, and mounting
// it twice would ask GitHub twice.
//
// So this provider stays, and the rule with it. It is the one place the five
// are mounted, it is where the request's inputs are wired to the settings it
// depends on, and it is what carries the answer to a bar and a page that are
// never unmounted between pull requests.

export interface AppData {
  codeFont: CodeFontState;
  colorMode: ColorModeState;
  pulls: OpenPullsState;
  token: GitHubTokenState;
  watched: WatchedReposState;
}

const AppDataContext = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const codeFont = useCodeFont();
  const colorMode = useColorMode();
  const token = useGitHubToken();
  const watched = useWatchedRepos();
  const pulls = useOpenPulls({
    ready: token.hydrated && watched.hydrated,
    repos: watched.repos,
    token: token.token,
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
    () => ({ codeFont, colorMode, pulls, token, watched }),
    [codeFont, colorMode, pulls, token, watched]
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
