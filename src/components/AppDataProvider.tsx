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
// The token, the colour mode, the code font and the watch list each live in
// browser storage, and a hook that reads storage owns a copy of what it read.
// That was fine while only one screen was mounted at a time. The left bar is
// now on every page, so the bar and the page under it would hold two copies:
// adding a repository in the home page's dialog would leave the bar listing the
// old set until a reload.
// This provider mounts each hook once, above both.

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
