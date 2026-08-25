import { createContext, type ReactNode, useContext, useMemo } from 'react';

import { type ColorModeState, useColorMode } from '@/hooks/useColorMode';
import { type GitHubTokenState, useGitHubToken } from '@/hooks/useGitHubToken';
import { type OpenPullsState, useOpenPulls } from '@/hooks/useOpenPulls';
import {
  useWatchedRepos,
  type WatchedReposState,
} from '@/hooks/useWatchedRepos';

// One owner for the state the whole app shares.
//
// The token, the colour mode and the watch list each live in browser storage,
// and a hook that reads storage owns a copy of what it read. That was fine while
// only one screen was mounted at a time. The left bar is now on every page, so
// the bar and the page under it would hold two copies: adding a repository in
// the home page's dialog would leave the bar listing the old set until a reload.
// This provider mounts each hook once, above both.

export interface AppData {
  colorMode: ColorModeState;
  pulls: OpenPullsState;
  token: GitHubTokenState;
  watched: WatchedReposState;
}

const AppDataContext = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const colorMode = useColorMode();
  const token = useGitHubToken();
  const watched = useWatchedRepos();
  const pulls = useOpenPulls({
    ready: token.hydrated && watched.hydrated,
    repos: watched.repos,
    token: token.token,
  });

  const value = useMemo<AppData>(
    () => ({ colorMode, pulls, token, watched }),
    [colorMode, pulls, token, watched]
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
