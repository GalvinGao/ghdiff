import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchWithRefresh } from '@/lib/authFetch';
import { formatBytes } from '@/lib/byteSize';
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
import { readStreamedText } from '@/lib/streamText';

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
  /**
   * Bytes of patch read so far, while `state` is 'fetching'. There is no total
   * to divide it by: github.com's `.diff` answers chunked and states no
   * `content-length`, and the one it states elsewhere counts compressed bytes.
   * So this is a count and never a percentage.
   */
  bytes?: number;
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
}): ReviewPatchState {
  const { target } = options;
  const [data, setData] = useState<ReviewData>(EMPTY_REVIEW_DATA);
  const [state, setState] = useState<PatchLoadState>('fetching');
  const [error, setError] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<number | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [bytes, setBytes] = useState<number | undefined>(undefined);
  const controllerRef = useRef<AbortController | null>(null);

  const query = reviewTargetQuery(target).toString();
  const cacheKey = reviewTargetKey(target);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setData(EMPTY_REVIEW_DATA);
    setError(undefined);
    setStatus(undefined);
    setNotice(undefined);
    setBytes(undefined);
    setState('fetching');

    try {
      const response = await fetchWithRefresh(`/api/diff?${query}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      setNotice(response.headers.get(NOTICE_HEADER) ?? undefined);
      // Read a chunk at a time so the wait has a figure on it. A patch of tens
      // of megabytes is a long stare at one sentence, and the count of what has
      // arrived is the only honest thing there is to say about it: nothing on
      // the wire states a total. The label is what decides whether this reaches
      // React, so a chunk that does not move the figure costs no render.
      const body = await readStreamedText(response, {
        onBytes: (read) => {
          if (controller.signal.aborted) return;
          setBytes((shown) =>
            shown != null && formatBytes(shown) === formatBytes(read)
              ? shown
              : read
          );
        },
      });
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
  }, [cacheKey, query]);

  useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  const retry = useCallback(() => {
    void load();
  }, [load]);

  return { data, state, error, status, notice, bytes, retry };
}
