import { useCallback, useEffect, useRef, useState } from 'react';

import { withGitHubToken } from './useGitHubToken';
import {
  buildReviewData,
  EMPTY_REVIEW_DATA,
  type ReviewData,
} from '@/lib/reviewData';
import {
  type ReviewTarget,
  reviewTargetKey,
  reviewTargetQuery,
} from '@/lib/reviewTarget';

export type PatchLoadState = 'fetching' | 'parsing' | 'ready' | 'error';

export interface ReviewPatchState {
  data: ReviewData;
  state: PatchLoadState;
  error?: string;
  /**
   * The status the request failed with, kept beside the message because the
   * message alone cannot say which failures the reviewer can act on. Absent
   * when the request never came back at all.
   */
  status?: number;
  /** What the diff source could not carry, when it said so. */
  notice?: string;
  retry(): void;
}

/** The route sets this when a fallback source left something out. */
const NOTICE_HEADER = 'x-ghdiff-notice';

/**
 * Fetches the patch for a target and parses it into review data.
 *
 * ghdiff loads the whole patch before it renders, unlike diffs-hub, which
 * streams file diffs into the viewer as they arrive. Holding the whole diff in
 * one array is what lets a filter change be a pure array pass.
 */
export function useReviewPatch(options: {
  target: ReviewTarget;
  token?: string;
  /**
   * False until the stored token has been read. Loading before then sends one
   * unauthenticated request, which a private repository answers with 404, and
   * the reviewer sees an error flash before the real load.
   */
  tokenReady: boolean;
}): ReviewPatchState {
  const { target, token, tokenReady } = options;
  const [data, setData] = useState<ReviewData>(EMPTY_REVIEW_DATA);
  const [state, setState] = useState<PatchLoadState>('fetching');
  const [error, setError] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<number | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const controllerRef = useRef<AbortController | null>(null);

  const query = reviewTargetQuery(target).toString();
  const cacheKey = reviewTargetKey(target);

  const load = useCallback(async () => {
    if (!tokenReady) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setData(EMPTY_REVIEW_DATA);
    setError(undefined);
    setStatus(undefined);
    setNotice(undefined);
    setState('fetching');

    try {
      const response = await fetch(
        `/api/diff?${query}`,
        withGitHubToken(token, { signal: controller.signal })
      );
      const body = await response.text();
      setNotice(response.headers.get(NOTICE_HEADER) ?? undefined);
      if (!response.ok) {
        setStatus(response.status);
        throw new Error(
          body.trim().length > 0
            ? body.trim()
            : `Request failed (${response.status}).`
        );
      }
      if (controller.signal.aborted) return;

      setState('parsing');
      // Yield once so the browser paints the parsing state before the patch
      // parse takes the main thread.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (controller.signal.aborted) return;

      setData(buildReviewData(body, cacheKey));
      setState('ready');
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(
        cause instanceof Error ? cause.message : 'Could not load that diff.'
      );
      setState('error');
    }
  }, [cacheKey, query, token, tokenReady]);

  useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  const retry = useCallback(() => {
    void load();
  }, [load]);

  return { data, state, error, status, notice, retry };
}
