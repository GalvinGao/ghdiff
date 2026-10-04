import { useSharedQuery } from './useSharedQuery';
import { rpc } from '@/lib/rpc/client';

/**
 * How long the figure is drawn from another tab or the last load before it is
 * asked for again. It is an estimate on purpose, so a minute behind is nothing.
 */
const SERVED_STALE_MS = 60_000;

/**
 * How many diffs this deployment has served. It is one number about the app
 * itself, so it carries no token and every reviewer reads the same one.
 *
 * A failure answers with nothing rather than with an error. The footer is not
 * where a reviewer goes to find out that something is wrong, and a counter
 * that cannot be read is not a thing that stops them working.
 */
export function useServedCount(): number | undefined {
  const query = useSharedQuery({
    queryKey: ['stats.served'],
    fetch: (signal) => rpc.stats.served(undefined, { signal }),
    persist: true,
    staleTime: SERVED_STALE_MS,
    shareWindowMs: SERVED_STALE_MS,
  });
  return query.data?.count;
}
