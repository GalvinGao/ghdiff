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
  /**
   * Accepts `owner/repo`, a github.com URL, or a GitLab project — bare, as
   * `host:group/project`, or as a URL on a configured host. Returns false if
   * unparseable.
   */
  add(input: string): boolean;
  remove(repo: WatchedRepo): void;
  move(activeKey: string, overKey: string): void;
}

/**
 * The repositories whose open pull requests appear in the switcher.
 *
 * The list is one of the app's settings, so watching a repository on the home
 * page reaches every other tab, left bar and all. The GitLab hosts travel in
 * because `add` parses against them: a host this deployment does not serve is
 * not a repository that can be watched.
 */
export function useWatchedRepos(options: {
  gitlabHosts: readonly string[];
}): WatchedReposState {
  const { value, setValue, hydrated } = usePreference(watchedReposPreference);
  const { gitlabHosts } = options;

  const add = useCallback(
    (input: string) => {
      const parsed = parseWatchedRepo(input, gitlabHosts);
      if (parsed == null) return false;
      setValue(dedupeWatchedRepos([...value, parsed]));
      return true;
    },
    [setValue, value, gitlabHosts]
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
