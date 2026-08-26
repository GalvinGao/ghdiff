import { useEffect, useState } from 'react';

import { rpc } from '@/lib/rpc/client';

/**
 * How many diffs this deployment has served. It is one number about the app
 * itself, so it carries no token and every reviewer reads the same one.
 *
 * A failure answers with nothing rather than with an error. The footer is not
 * where a reviewer goes to find out that something is wrong, and a counter
 * that cannot be read is not a thing that stops them working.
 */
export function useServedCount(): number | undefined {
  const [count, setCount] = useState<number | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const result = await rpc.stats.served(undefined);
        if (live) setCount(result.count);
      } catch {
        // The footer prints no figure, and that is the whole of it.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  return count;
}
