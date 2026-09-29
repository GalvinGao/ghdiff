import { useCallback, useEffect, useRef, useState } from 'react';

import { m } from '../paraglide/messages.js';
import type { PullDetails } from '@/lib/pullDetails';
import { rpc, rpcErrorMessage } from '@/lib/rpc/client';

export interface PullDetailsState {
  data?: PullDetails;
  error?: string;
  loading: boolean;
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
  // When the answer on screen arrived, and whether one is on its way. Both are
  // read in an event handler and never while rendering, so neither is state.
  const receivedAtRef = useRef(0);
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (owner == null || repo == null || number == null) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    inFlightRef.current = true;
    setLoading(true);
    setError(undefined);

    try {
      const details = await rpc.pulls.get(
        { number, owner, repo },
        { signal: controller.signal }
      );
      receivedAtRef.current = Date.now();
      setData(details);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(
        rpcErrorMessage(
          cause,
          m.use_pull_details_could_not_load_this_pull_request()
        )
      );
    } finally {
      if (!controller.signal.aborted) {
        inFlightRef.current = false;
        setLoading(false);
      }
    }
  }, [number, owner, repo]);

  // The card is unmounted while it is closed, so a picture is first asked for
  // when the reviewer opens it, which can be long after its five minutes. The
  // browser keeps a file it did load for a month, so only a file never loaded
  // in time fails, and the failure is what asks for a new signature.
  const lifetimeMs = data?.attachments?.lifetimeMs;
  const renewAttachments = useCallback(() => {
    if (lifetimeMs == null || inFlightRef.current) return;
    if (Date.now() - receivedAtRef.current < lifetimeMs - RENEW_MARGIN_MS) {
      return;
    }
    void load();
  }, [lifetimeMs, load]);

  useEffect(() => {
    if (owner == null || repo == null || number == null) {
      setData(undefined);
      setError(undefined);
      return undefined;
    }
    void load();
    return () => controllerRef.current?.abort();
  }, [load, number, owner, repo]);

  return { data, error, loading, renewAttachments };
}
