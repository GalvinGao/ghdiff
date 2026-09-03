import { useCallback } from 'react';

import { usePreference, watchedReposPreference } from './preferences';
import {
  dedupeWatchedRepos,
  formatWatchedRepo,
  parseWatchedRepo,
  type WatchedRepo,
} from '@/lib/pulls';

export interface WatchedReposState {
  repos: WatchedRepo[];
  hydrated: boolean;
  /** Accepts `owner/repo` or a github.com URL. Returns false if unparseable. */
  add(input: string): boolean;
  remove(repo: WatchedRepo): void;
}

/**
 * The repositories whose open pull requests appear in the switcher.
 *
 * The list is one of the app's settings, so watching a repository on the home
 * page reaches every other tab, left bar and all.
 */
export function useWatchedRepos(): WatchedReposState {
  const { value, setValue, hydrated } = usePreference(watchedReposPreference);

  const add = useCallback(
    (input: string) => {
      const parsed = parseWatchedRepo(input);
      if (parsed == null) return false;
      setValue(dedupeWatchedRepos([...value, parsed]));
      return true;
    },
    [setValue, value]
  );

  const remove = useCallback(
    (repo: WatchedRepo) => {
      const key = formatWatchedRepo(repo).toLowerCase();
      setValue(
        value.filter((item) => formatWatchedRepo(item).toLowerCase() !== key)
      );
    },
    [setValue, value]
  );

  return { repos: value, hydrated, add, remove };
}
