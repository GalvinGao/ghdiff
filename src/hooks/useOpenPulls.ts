import { useEffect, useRef } from 'react';

import { m } from '../paraglide/messages.js';
import {
  useForcedRefetch,
  useSharedCache,
  useSharedQuery,
} from './useSharedQuery';
import {
  formatWatchedRepo,
  type OpenPullsData,
  parseWatchedRepo,
  type WatchedRepo,
} from '@/lib/pulls';
import { rpc, rpcErrorMessage } from '@/lib/rpc/client';

export interface OpenPullsState {
  data?: OpenPullsData;
  loading: boolean;
  error?: string;
  reload(): void;
}

const EMPTY_DATA: OpenPullsData = { pulls: [], failures: [] };

/** The watch list back out of the joined key the hook depends on. */
function reposFromKey(key: string): WatchedRepo[] {
  return key
    .split(',')
    .map((entry) => parseWatchedRepo(entry))
    .filter((entry): entry is WatchedRepo => entry != null);
}

/**
 * How long a list another tab or the last load left behind is shown without
 * asking again. The bar is on every page of every tab, so this is the request a
 * reviewer with several tabs open used to make most often, and half a minute is
 * well inside how often a pull request's status square changes.
 */
const PULLS_STALE_MS = 30_000;

/**
 * The open pull requests of the watched repositories. The left bar is on every
 * page, so this runs for the whole session and one instance feeds every list.
 *
 * `ready` holds the first request back until the watch list has been read out of
 * storage. Without it the app asks GitHub about no repositories at all, and then
 * asks again a tick later. The credential needs no such wait: it is in a cookie
 * the browser attaches itself.
 *
 * The answer is shared by every tab and kept on disk, so a new tab draws the
 * list the last one had before GitHub has answered it. A change of the watch
 * list keeps the old rows on screen until the new ones arrive, which is what
 * the hand-written hook before this one did as well.
 */
export function useOpenPulls(options: {
  ready: boolean;
  repos: readonly WatchedRepo[];
}): OpenPullsState {
  const { ready, repos } = options;

  // The watch list travels as one comma-joined string and the request is built
  // back out of it. The array's identity changes on every render of whatever
  // owns it, and a key built from the array would ask again each time. The
  // string compares by value. It is sorted, because the order is the list's to
  // draw and not GitHub's to answer: a drag in the watch list reorders the rows
  // on screen and asks GitHub nothing.
  const repoKey = repos.map(formatWatchedRepo).toSorted().join(',');
  const queryKey = ['pulls.list', repoKey];
  const shared = useSharedCache();
  // The session the rows on screen were fetched under. A change of watch list
  // keeps them on screen until the new ones arrive, but only within that
  // session: a sign-out or a change of account resets every answer, and rows
  // carried across it would be the previous account's private ones.
  const rowsSession = useRef<number | undefined>(undefined);

  const query = useSharedQuery<OpenPullsData>({
    queryKey,
    fetch: (signal) =>
      rpc.pulls.list({ repos: reposFromKey(repoKey) }, { signal }),
    enabled: ready && repoKey.length > 0,
    // A list with a failure in it is shown, and never kept: the next load
    // would draw a rate limit from an hour ago before GitHub had been asked.
    persist: (answer) => (answer.failures.length === 0 ? answer : undefined),
    staleTime: PULLS_STALE_MS,
    // A list another tab fetched, or the last load left, stands in for a fetch
    // for as long as it would count as fresh here. A stored list reaches the
    // query only once the session has confirmed whose it is, by which time the
    // query is already asking, so the window is what lets it take the list.
    // The reload in the bar still asks GitHub: it is a forced refetch.
    shareWindowMs: PULLS_STALE_MS,
    placeholderData: (previous) =>
      previous !== undefined && rowsSession.current === shared?.ticket()
        ? previous
        : undefined,
  });
  const fetched = query.isPlaceholderData ? undefined : query.data;
  useEffect(() => {
    if (fetched !== undefined) rowsSession.current = shared?.ticket();
  }, [fetched, shared]);

  const reload = useForcedRefetch(queryKey, query.refetch);

  if (!ready) return { loading: true, reload };
  if (repoKey.length === 0) return { data: EMPTY_DATA, loading: false, reload };
  return {
    data: query.data,
    // Before the first answer arrives there is nothing on screen yet, and a
    // list that says "empty" is wrong. `loading` covers the wait either way.
    loading: query.isFetching,
    error:
      query.error == null
        ? undefined
        : rpcErrorMessage(
            query.error,
            m.use_open_pulls_could_not_load_pull_requests()
          ),
    reload,
  };
}
