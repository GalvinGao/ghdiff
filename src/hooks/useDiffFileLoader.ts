import type { FileDiffContentsLoader, FileDiffMetadata } from '@pierre/diffs';
import { useCallback, useState } from 'react';

import { withGitHubToken } from './useGitHubToken';
import {
  FILE_TOO_LARGE,
  MAX_FILE_BYTES,
  oldFileFromPatch,
  patchFitsNewFile,
  splitFileLines,
} from '@/lib/diffHydration';
import { type ReviewTarget, reviewTargetQuery } from '@/lib/reviewTarget';
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
const GENERIC_FAILURE = 'Could not read that file from GitHub.';
const STALE_FAILURE =
  'That file has changed on GitHub since this diff was made. Reload to see its unmodified lines.';

export interface DiffFileLoader {
  /** Passed straight to the viewer as its `loadDiffFiles` option. */
  loadDiffFiles: FileDiffContentsLoader;
  /** The last failure, for the strip along the foot of the screen. */
  error?: string;
  dismissError(): void;
}

export function useDiffFileLoader(options: {
  target: ReviewTarget;
  token?: string;
}): DiffFileLoader {
  const { target, token } = options;
  const [error, setError] = useState<string | undefined>(undefined);
  // A string, not the target: the route's loader re-runs and hands down a new
  // object for the same review.
  const query = reviewTargetQuery(target).toString();

  const loadDiffFiles = useCallback<FileDiffContentsLoader>(
    async (fileDiff: FileDiffMetadata) => {
      try {
        const contents = await fetchFile(query, fileDiff.name, token);
        setError(undefined);
        const newFile = { name: fileDiff.name, contents };
        // A pure rename has no hunks and no old side to rebuild; the library
        // wants an explicit null for it.
        if (fileDiff.type === 'rename-pure') {
          return { oldFile: null, newFile };
        }
        const newLines = splitFileLines(contents);
        if (!patchFitsNewFile(fileDiff, newLines)) {
          throw new Error(STALE_FAILURE);
        }
        return {
          oldFile: {
            name: fileDiff.prevName ?? fileDiff.name,
            contents: oldFileFromPatch(fileDiff, newLines),
          },
          newFile,
        };
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : GENERIC_FAILURE);
        // Rethrown: the viewer must not hydrate a file it cannot trust, and
        // leaving the diff partial is what lets the reviewer press again.
        throw cause;
      }
    },
    [query, token]
  );

  const dismissError = useCallback(() => setError(undefined), []);

  return { loadDiffFiles, error, dismissError };
}

async function fetchFile(
  query: string,
  path: string,
  token: string | undefined
): Promise<string> {
  const response = await fetch(
    `/api/file?${query}&path=${encodeURIComponent(path)}`,
    withGitHubToken(token)
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      body.trim().length > 0
        ? body.trim()
        : `Request failed (${response.status}).`
    );
  }
  // Counted on the way in, because the route can only turn away a file whose
  // size GitHub declared, and a compressed answer declares the wrong one.
  return await readStreamedText(response, {
    maxBytes: MAX_FILE_BYTES,
    tooLarge: FILE_TOO_LARGE,
  });
}
