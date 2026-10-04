import type { FileDiffContentsLoader, FileDiffMetadata } from '@pierre/diffs';
import { useCallback, useState } from 'react';

import { m } from '../paraglide/messages.js';
import { useSharedCache } from './useSharedQuery';
import { fetchWithRefresh } from '@/lib/authFetch';
import {
  FILE_TOO_LARGE,
  MAX_FILE_BYTES,
  oldFileFromPatch,
  patchFitsNewFile,
  splitFileLines,
} from '@/lib/diffHydration';
import type { SharedCache, TextAnswer } from '@/lib/queryCache/sharedCache';
import {
  isGitHubTarget,
  type ReviewTarget,
  reviewTargetQuery,
} from '@/lib/reviewTarget';
import { readStreamedText } from '@/lib/streamText';

// What the viewer calls when a reviewer expands the unmodified lines around a
// hunk. `@pierre/diffs` asks for both whole files and keeps the patch's own
// hunks, so the changes on screen do not move: what arrives fills in the lines
// between them.
//
// One request per file, for the new side. The old side is rebuilt from it and
// from the patch. See `src/lib/diffHydration.ts` for why that is exact.

// Both are said out loud rather than logged. A reviewer pressed something and
// nothing happened, and the strip along the foot of the screen is where the
// reason goes.
const GENERIC_FAILURE =
  m.use_diff_file_loader_could_not_read_that_file_from_github;
const STALE_FAILURE =
  m.use_diff_file_loader_that_file_has_changed_on_github_since_this;

export interface DiffFileLoader {
  /** Passed straight to the viewer as its `loadDiffFiles` option. */
  loadDiffFiles: FileDiffContentsLoader;
  /** Metadata identity keeps pending loads scoped to their original diff. */
  loadingFiles: readonly FileDiffMetadata[];
  /** The last failure, for the strip along the foot of the screen. */
  error?: string;
  dismissError(): void;
}

export function useDiffFileLoader(options: {
  target: ReviewTarget;
}): DiffFileLoader {
  const { target } = options;
  const [error, setError] = useState<string | undefined>(undefined);
  const [loadingFiles, setLoadingFiles] = useState<readonly FileDiffMetadata[]>(
    []
  );
  // A string, not the target: the route's loader re-runs and hands down a new
  // object for the same review.
  const query = reviewTargetQuery(target).toString();
  // Kept between loads and tabs, and checked with GitHub by its ETag each
  // time: a file of a pull request's head moves with every push.
  const shared = useSharedCache();
  const sharedFiles = isGitHubTarget(target) ? shared : null;

  const loadDiffFiles = useCallback<FileDiffContentsLoader>(
    async (fileDiff: FileDiffMetadata) => {
      setLoadingFiles((files) => [...files, fileDiff]);
      try {
        const contents = await fetchFile(query, fileDiff.name, sharedFiles);
        setError(undefined);
        const newFile = { name: fileDiff.name, contents };
        // A pure rename has no hunks and no old side to rebuild; the library
        // wants an explicit null for it.
        if (fileDiff.type === 'rename-pure') {
          return { oldFile: null, newFile };
        }
        const newLines = splitFileLines(contents);
        if (!patchFitsNewFile(fileDiff, newLines)) {
          throw new Error(STALE_FAILURE());
        }
        return {
          oldFile: {
            name: fileDiff.prevName ?? fileDiff.name,
            contents: oldFileFromPatch(fileDiff, newLines),
          },
          newFile,
        };
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : GENERIC_FAILURE());
        // Rethrown: the viewer must not hydrate a file it cannot trust, and
        // leaving the diff partial is what lets the reviewer press again.
        throw cause;
      } finally {
        // A virtualized file can remount while an earlier request is pending.
        // Remove just this load so the newer one keeps its indicator.
        setLoadingFiles((files) => {
          const index = files.indexOf(fileDiff);
          return index === -1 ? files : files.toSpliced(index, 1);
        });
      }
    },
    [query, sharedFiles]
  );

  const dismissError = useCallback(() => setError(undefined), []);

  return { loadDiffFiles, loadingFiles, error, dismissError };
}

async function fetchFile(
  query: string,
  path: string,
  shared: SharedCache | null
): Promise<string> {
  const download = async (etag: string | undefined): Promise<TextAnswer> => {
    const response = await fetchWithRefresh(
      `/api/file?${query}&path=${encodeURIComponent(path)}`,
      {
        cache: 'no-store',
        headers: etag == null ? undefined : { 'if-none-match': etag },
      }
    );
    if (response.status === 304) return { status: 'unchanged' };
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        body.trim().length > 0
          ? body.trim()
          : m.use_diff_file_loader_request_failed({ status: response.status })
      );
    }
    // Counted on the way in, because the route can only turn away a file whose
    // size GitHub declared, and a compressed answer declares the wrong one.
    const text = await readStreamedText(response, {
      maxBytes: MAX_FILE_BYTES,
      tooLarge: FILE_TOO_LARGE(),
    });
    return {
      status: 'fresh',
      text,
      etag: response.headers.get('etag') ?? undefined,
    };
  };
  if (shared == null) {
    const answer = await download(undefined);
    if (answer.status !== 'fresh') throw new Error('Unexpected 304.');
    return answer.text;
  }
  const answer = await shared.fetchText({
    key: ['file', query, path],
    fetch: download,
  });
  return answer.text;
}
