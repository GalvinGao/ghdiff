import {
  queryOptions,
  skipToken,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { m } from '../paraglide/messages.js';
import { fetchWithRefresh } from '@/lib/authFetch';
import { formatBytes } from '@/lib/byteSize';
import { sharedCacheOf, type TextAnswer } from '@/lib/queryCache/sharedCache';
import {
  buildReviewData,
  EMPTY_REVIEW_DATA,
  type ReviewData,
} from '@/lib/reviewData';
import {
  isGitHubTarget,
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
 * How long a patch counts as current, and how long one nobody is reading is
 * kept. One figure for both, because the case they serve is one case: Approve
 * and next prefetches the next layer when the review dialog opens, and the
 * reviewer may write a note for minutes before the press. Past that the branch
 * may have moved, so a screen opened later asks again — and a patch runs to
 * tens of megabytes, so nothing is held longer than it is useful.
 */
const PATCH_FRESH_MS = 5 * 60_000;

/** The patch as the route answered it: its text, and its notice if any. */
interface PatchResponse {
  body: string;
  notice?: string;
}

/** A failure the route answered, with the status the panel decides on. */
class PatchRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function patchQueryKey(cacheKey: string) {
  return ['patch', cacheKey] as const;
}

/**
 * The bytes read so far, written beside the patch while it downloads. A key of
 * its own rather than a field of the patch's state, because a query has no
 * progress of its own to report — and a prefetch started by another screen is
 * still the download this one is waiting on, so the count has to live where
 * both can reach it.
 */
function patchBytesKey(cacheKey: string) {
  return ['patch', cacheKey, 'bytes'] as const;
}

/**
 * The query for one target's patch: what `useReviewPatch` reads, and what a
 * screen about to open that target prefetches.
 *
 * The text is cached and the parse is not. Parsing is one synchronous pass
 * over the whole patch, so a prefetch that parsed would freeze the tab under a
 * reviewer still typing their note; the screen that reads the patch parses it.
 */
export function patchQueryOptions(target: ReviewTarget) {
  const cacheKey = reviewTargetKey(target);
  const query = reviewTargetQuery(target).toString();
  return queryOptions({
    queryKey: patchQueryKey(cacheKey),
    queryFn: async ({ client, signal }): Promise<PatchResponse> => {
      const bytesKey = patchBytesKey(cacheKey);
      client.setQueryData(bytesKey, 0);
      // One ask of the route. With `etag` it may answer 304, which says the
      // copy the shared cache holds is still the patch.
      const download = async (
        etag: string | undefined
      ): Promise<TextAnswer> => {
        const response = await fetchWithRefresh(`/api/diff?${query}`, {
          cache: 'no-store',
          signal,
          headers: etag == null ? undefined : { 'if-none-match': etag },
        });
        if (response.status === 304) return { status: 'unchanged' };
        // Read a chunk at a time so the wait has a figure on it. A patch of
        // tens of megabytes is a long stare at one sentence, and the count of
        // what has arrived is the only honest thing there is to say about it:
        // nothing on the wire states a total. The label is what decides
        // whether this reaches React, so a chunk that does not move the figure
        // costs no render.
        const body = await readStreamedText(response, {
          onBytes: (read) => {
            const shown = client.getQueryData<number>(bytesKey) ?? 0;
            if (formatBytes(shown) !== formatBytes(read)) {
              client.setQueryData(bytesKey, read);
            }
          },
        });
        if (!response.ok) {
          throw new PatchRequestError(
            body.trim().length > 0
              ? body.trim()
              : m.use_review_patch_request_failed({ status: response.status }),
            response.status
          );
        }
        return {
          status: 'fresh',
          text: body,
          etag: response.headers.get('etag') ?? undefined,
          notice: response.headers.get(NOTICE_HEADER) ?? undefined,
        };
      };

      // A local diff moves under the reader and states no ETag, so only a
      // patch from GitHub goes through the cache every tab shares — found by
      // the client this query runs in, which is how a prefetch reaches it too.
      const shared = isGitHubTarget(target) ? sharedCacheOf(client) : undefined;
      if (shared == null) {
        const answer = await download(undefined);
        if (answer.status !== 'fresh') throw new Error('Unexpected 304.');
        return { body: answer.text, notice: answer.notice };
      }
      const answer = await shared.fetchText({
        key: ['diff', cacheKey],
        signal,
        fetch: download,
      });
      return { body: answer.text, notice: answer.notice };
    },
    staleTime: PATCH_FRESH_MS,
    gcTime: PATCH_FRESH_MS,
    // A patch under review must not change under the reviewer, so nothing but
    // a new screen or the panel's own retry asks again. And a failure is an
    // answer — a 404 or a spent quota — that a second ask gets again.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}

/**
 * Fetches the patch for a target and parses it into review data.
 *
 * ghdiff loads the whole patch before it renders, unlike diffs-hub, which
 * streams file diffs into the viewer as they arrive. Holding the whole diff in
 * one array is what lets a filter change be a pure array pass.
 */
export function useReviewPatch(options: {
  target: ReviewTarget;
  /**
   * Paths the diff source says git is not tracking, so their files can be
   * marked as such. Only the `ghdiff` command has any, and it writes them into
   * the document it serves: a patch from GitHub is a patch of committed files.
   */
  untracked?: readonly string[];
}): ReviewPatchState {
  const { target, untracked } = options;
  const queryClient = useQueryClient();
  const cacheKey = reviewTargetKey(target);
  // The array is the dependency: the sole caller reads it once at module scope,
  // so its identity is stable, and joining it to a string first would allocate
  // the whole list on every render to guard against a caller that does not
  // exist.
  const untrackedPaths = useMemo(
    () =>
      untracked == null || untracked.length === 0
        ? undefined
        : new Set(untracked),
    [untracked]
  );

  // A fresh options object each render is free: the query is found by its
  // key, which is made of strings, so a target object rebuilt by the route
  // asks for nothing again.
  const patch = useQuery(patchQueryOptions(target));
  const { data: bytes } = useQuery<number>({
    queryKey: patchBytesKey(cacheKey),
    queryFn: skipToken,
  });

  // The parse of the answer on screen, kept with the answer it was made from:
  // an answer with no parse beside it yet is a patch still being parsed.
  const [parsed, setParsed] = useState<{
    from: PatchResponse;
    data: ReviewData;
  } | null>(null);
  const response = patch.data;
  useEffect(() => {
    if (response == null) return undefined;
    // Yield once so the browser paints the parsing state before the patch
    // parse takes the main thread.
    const timer = window.setTimeout(() => {
      setParsed({
        from: response,
        data: buildReviewData(response.body, cacheKey, untrackedPaths),
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [cacheKey, response, untrackedPaths]);

  // Reset rather than refetch: an errored query that refetches keeps its
  // error until the answer lands, and the panel has to go back to the wait.
  const retry = useCallback(() => {
    void queryClient.resetQueries({
      queryKey: patchQueryKey(cacheKey),
      exact: true,
    });
  }, [cacheKey, queryClient]);

  const ready = response != null && parsed?.from === response;
  const state: PatchLoadState =
    patch.status === 'error'
      ? 'error'
      : response == null
        ? 'fetching'
        : ready
          ? 'ready'
          : 'parsing';
  const { error } = patch;
  return {
    data: ready ? parsed.data : EMPTY_REVIEW_DATA,
    state,
    error:
      error == null
        ? undefined
        : error instanceof Error
          ? error.message
          : m.use_review_patch_could_not_load_that_diff(),
    status: error instanceof PatchRequestError ? error.status : undefined,
    notice: response?.notice,
    bytes:
      state === 'fetching' && bytes != null && bytes > 0 ? bytes : undefined,
    retry,
  };
}
