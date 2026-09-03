import { useCallback, useEffect, useRef, useState } from 'react';

import type { PullDetails } from '@/lib/pullDetails';
import { rpc, rpcErrorMessage } from '@/lib/rpc/client';

export interface PullDetailsState {
  data?: PullDetails;
  error?: string;
  loading: boolean;
}

/**
 * The details of the pull request under review. It runs as soon as the review
 * opens, because the header shows the title: a header that filled in only when
 * a card was opened would leave the reviewer looking at a bare number.
 *
 * The hook depends on the three parts of the pull request rather than on the
 * target object, whose identity changes with every read of the RSC payload.
 */
export function usePullDetails(options: {
  number?: number;
  owner?: string;
  repo?: string;
}): PullDetailsState {
  const { number, owner, repo } = options;
  const [data, setData] = useState<PullDetails | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (owner == null || repo == null || number == null) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(undefined);

    try {
      setData(
        await rpc.pulls.get(
          { number, owner, repo },
          { signal: controller.signal }
        )
      );
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(rpcErrorMessage(cause, 'Could not load this pull request.'));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [number, owner, repo]);

  useEffect(() => {
    if (owner == null || repo == null || number == null) {
      setData(undefined);
      setError(undefined);
      return undefined;
    }
    void load();
    return () => controllerRef.current?.abort();
  }, [load, number, owner, repo]);

  return { data, error, loading };
}
