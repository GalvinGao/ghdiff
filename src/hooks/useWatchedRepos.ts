import { arrayMove } from '@dnd-kit/sortable';
import { useCallback } from 'react';

import { usePreference, watchedReposPreference } from './preferences';
import {
  dedupeWatchedRepos,
  isSameWatchedRepo,
  parseWatchedRepo,
  watchedRepoKey,
  type WatchedRepo,
} from '@/lib/pulls';

export interface WatchedReposState {
  repos: WatchedRepo[];
  hydrated: boolean;
  /** Accepts `owner/repo` or a github.com URL. Returns false if unparseable. */
  add(input: string): boolean;
  remove(repo: WatchedRepo): void;
  move(activeKey: string, overKey: string): void;
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
      setValue(value.filter((item) => !isSameWatchedRepo(item, repo)));
    },
    [setValue, value]
  );

  const move = useCallback(
    (activeKey: string, overKey: string) => {
      const from = value.findIndex(
        (repo) => watchedRepoKey(repo) === activeKey
      );
      const to = value.findIndex((repo) => watchedRepoKey(repo) === overKey);
      if (from < 0 || to < 0 || from === to) return;
      setValue(arrayMove(value, from, to));
    },
    [setValue, value]
  );

  return { repos: value, hydrated, add, remove, move };
}
