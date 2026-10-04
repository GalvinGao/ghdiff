import {
  QueryClient,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query';
import { createContext, useCallback, useContext } from 'react';

import {
  createBrowserSharedCache,
  type Persist,
  type SharedCache,
} from '@/lib/queryCache/sharedCache';

// The React half of the shared cache: the client every request goes through,
// and the hook a request is made with. See `@/lib/queryCache/sharedCache`.

/**
 * The cache every tab shares, or nothing: on the server, where there are no
 * tabs, and under the `ghdiff` command, which asks GitHub nothing. A query
 * with no shared cache fetches for itself, the way React Query always does.
 */
export const SharedCacheContext = createContext<SharedCache | null>(null);

export function useSharedCache(): SharedCache | null {
  return useContext(SharedCacheContext);
}

/**
 * The defaults are the ones every hand-written hook here used to have. No
 * retry, because a failure from GitHub is usually an answer — a 404, a spent
 * quota — and asking again only spends more of it. No refetch on focus, because
 * an anonymous reviewer has sixty requests an hour and a tab switch is not a
 * reason to spend one.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, retry: false },
    },
  });
}

let browserCaches: { client: QueryClient; shared: SharedCache } | undefined;

/**
 * The client and cache for this document, made once. A browser has one
 * document per tab and the tab is the unit the cache is shared between, so a
 * second pair — from a render React throws away — would be a second tab that
 * does not exist, holding its own lease and its own channel. The server makes a
 * client per render instead, in `AppShell`, and no cache at all.
 */
export function browserQueryCaches(): {
  client: QueryClient;
  shared: SharedCache;
} {
  if (browserCaches == null) {
    const client = createQueryClient();
    browserCaches = { client, shared: createBrowserSharedCache(client) };
  }
  return browserCaches;
}

export type SharedQueryOptions<T> = Omit<
  UseQueryOptions<T, Error, T, readonly unknown[]>,
  'queryFn' | 'queryKey'
> & {
  /** Strings, numbers and booleans only: it is hashed as JSON across tabs. */
  queryKey: readonly unknown[];
  fetch: (signal: AbortSignal) => Promise<T>;
  persist?: Persist<T>;
  shareWindowMs?: number;
};

/**
 * A query whose answer every tab of the browser shares. One tab asks GitHub,
 * the others receive what it got, and the next load starts from it.
 */
export function useSharedQuery<T>(
  options: SharedQueryOptions<T>
): UseQueryResult<T, Error> {
  const shared = useSharedCache();
  const { fetch, persist, shareWindowMs, ...query } = options;
  return useQuery<T, Error, T, readonly unknown[]>({
    ...query,
    queryFn: ({ queryKey, signal }) =>
      shared == null
        ? fetch(signal)
        : shared.fetch({ fetch, persist, queryKey, shareWindowMs, signal }),
  });
}

/**
 * Puts the result of this tab's own write where every tab reads it. Without a
 * shared cache it is `setQueryData`, which is all a lone tab needs.
 *
 * `ticket` is what `useSessionTicket` gave when the write was sent. A write
 * that lands after the session ended or changed hands publishes nothing.
 */
export function usePublish(): <T>(
  queryKey: readonly unknown[],
  data: T,
  persist: Persist<T>,
  ticket?: number
) => void {
  const shared = useSharedCache();
  const client = useQueryClient();
  return useCallback(
    <T>(
      queryKey: readonly unknown[],
      data: T,
      persist: Persist<T>,
      ticket?: number
    ) => {
      if (shared == null) client.setQueryData(queryKey, data);
      else shared.publish(queryKey, data, persist, ticket);
    },
    [client, shared]
  );
}

/** The session as it stands, to hand to `publish` when the write lands. */
export function useSessionTicket(): () => number | undefined {
  const shared = useSharedCache();
  return useCallback(() => shared?.ticket(), [shared]);
}

/**
 * Refetches a shared query from GitHub, for a reload the reviewer pressed: an
 * answer another tab holds is the one they are asking to replace.
 */
export function useForcedRefetch(
  queryKey: readonly unknown[],
  refetch: () => Promise<unknown>
): () => void {
  const shared = useSharedCache();
  // The key is compared by value, so it travels as the JSON it is hashed by.
  const hash = JSON.stringify(queryKey);
  return useCallback(() => {
    shared?.forceNext(JSON.parse(hash) as readonly unknown[]);
    void refetch();
  }, [hash, refetch, shared]);
}
