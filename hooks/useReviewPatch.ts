'use client';

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
  retry(): void;
}

/**
 * Fetches the patch for a target and parses it into review data.
 *
 * Reviewer loads the whole patch before it renders, unlike diffs-hub, which
 * streams file diffs into the viewer as they arrive. Holding the whole diff in
 * one array is what lets a filter change be a pure array pass.
 */
export function useReviewPatch(options: {
  target: ReviewTarget;
  token?: string;
}): ReviewPatchState {
  const { target, token } = options;
  const [data, setData] = useState<ReviewData>(EMPTY_REVIEW_DATA);
  const [state, setState] = useState<PatchLoadState>('fetching');
  const [error, setError] = useState<string | undefined>(undefined);
  const controllerRef = useRef<AbortController | null>(null);

  const query = reviewTargetQuery(target).toString();
  const cacheKey = reviewTargetKey(target);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setData(EMPTY_REVIEW_DATA);
    setError(undefined);
    setState('fetching');

    try {
      const response = await fetch(
        `/api/diff?${query}`,
        withGitHubToken(token, { signal: controller.signal })
      );
      const body = await response.text();
      if (!response.ok) {
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
  }, [cacheKey, query, token]);

  useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  const retry = useCallback(() => {
    void load();
  }, [load]);

  return { data, state, error, retry };
}
