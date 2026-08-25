'use client';

import { useCallback } from 'react';

import { useStoredJson } from './useLocalStorage';
import {
  dedupeWatchedRepos,
  formatWatchedRepo,
  parseWatchedRepo,
  type WatchedRepo,
} from '@/lib/pulls';
import { WATCHED_REPOS_STORAGE_KEY } from '@/lib/storageKeys';

const EMPTY: WatchedRepo[] = [];

export interface WatchedReposState {
  repos: WatchedRepo[];
  hydrated: boolean;
  /** Accepts `owner/repo` or a github.com URL. Returns false if unparseable. */
  add(input: string): boolean;
  remove(repo: WatchedRepo): void;
}

/** The repositories whose open pull requests appear in the switcher. */
export function useWatchedRepos(): WatchedReposState {
  const { value, setValue, hydrated } = useStoredJson<WatchedRepo[]>(
    WATCHED_REPOS_STORAGE_KEY,
    EMPTY
  );

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
