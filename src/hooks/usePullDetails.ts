import { useCallback } from 'react';

import { useSharedQuery } from './useSharedQuery';
import { type PullRef, refQueryKey } from '@/lib/forges';
import type { PullDetails } from '@/lib/pullDetails';
import { withoutAttachments } from '@/lib/queryCache/persist';
import { rpc, rpcErrorMessage } from '@/lib/rpc/client';
import { m } from '@/paraglide/messages.js';

export interface PullDetailsState {
  data?: PullDetails;
  error?: string;
  loading: boolean;
  /** Asks again — the header's refresh control. */
  reload(): void;
  /**
   * Asks GitHub to sign the description's attachments again, when a file failed
   * to load and its signature is old enough to be the reason. Safe to call on
   * every failure: a signature still young is not renewed.
   */
  renewAttachments(): void;
}

// A signature is counted from the moment its answer arrived, which is a little
// after GitHub minted it. The margin covers that trip, and a renewal slightly
// early costs one request where one slightly late costs a broken picture.
const RENEW_MARGIN_MS = 30_000;

/**
 * The details of the pull request or merge request under review. It runs as
 * soon as the review opens, because the header shows the title: a header that
 * filled in only when a card was opened would leave the reviewer looking at a
 * bare number.
 *
 * The hook keys on the ref's parts rather than on the target object, whose
 * identity changes with every read of the RSC payload.
 *
 * The answer is shared between tabs and kept on disk without its signed
 * attachment addresses, so a reload draws the title at once and fetches the
 * whole answer behind it. See `@/lib/queryCache/persist`.
 */
export function usePullDetails(options: { ref?: PullRef }): PullDetailsState {
  const { ref } = options;
  const query = useSharedQuery<PullDetails>({
    queryKey: ['pulls.get', ...(ref == null ? [] : refQueryKey(ref))],
    fetch: (signal) => {
      if (ref == null) throw new Error('No pull request to ask about.');
      return rpc.pulls.get(ref, { signal });
    },
    enabled: ref != null,
    persist: withoutAttachments,
  });

  // The card is unmounted while it is closed, so a picture is first asked for
  // when the reviewer opens it, which can be long after its five minutes. The
  // browser keeps a file it did load for a month, so only a file never loaded
  // in time fails, and the failure is what asks for a new signature.
  //
  // The age is counted from `dataUpdatedAt`, the moment the answer reached this
  // tab or the one that shared it. An answer from disk carries no signatures,
  // so it has no lifetime to count against.
  const lifetimeMs = query.data?.attachments?.lifetimeMs;
  const { dataUpdatedAt, isFetching, refetch } = query;
  const renewAttachments = useCallback(() => {
    if (lifetimeMs == null || isFetching) return;
    if (Date.now() - dataUpdatedAt < lifetimeMs - RENEW_MARGIN_MS) return;
    void refetch();
  }, [dataUpdatedAt, isFetching, lifetimeMs, refetch]);

  const reload = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    data: query.data,
    error:
      query.error == null
        ? undefined
        : rpcErrorMessage(
            query.error,
            m.use_pull_details_could_not_load_this_pull_request()
          ),
    loading: query.isFetching,
    reload,
    renewAttachments,
  };
}
