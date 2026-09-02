import type { FileDiffContentsLoader, FileDiffMetadata } from '@pierre/diffs';
import { useCallback, useRef, useState } from 'react';

import { withGitHubToken } from './useGitHubToken';
import {
  ArchiveFileCollector,
  MAX_ARCHIVE_DOWNLOAD_BYTES,
  MAX_ARCHIVE_KEPT_BYTES,
} from '@/lib/archiveFiles';
import {
  FILE_TOO_LARGE,
  MAX_FILE_BYTES,
  oldFileFromPatch,
  patchFitsNewFile,
  splitFileLines,
} from '@/lib/diffHydration';
import { type ReviewTarget, reviewTargetQuery } from '@/lib/reviewTarget';
import { readStreamedText } from '@/lib/streamText';
import { TarReader } from '@/lib/tar';

// What the viewer calls when a reviewer expands the unmodified lines around a
// hunk. `@pierre/diffs` asks for both whole files and keeps the patch's own
// hunks, so the changes on screen do not move: what arrives fills in the lines
// between them.
//
// The first expansion starts one `/api/archive` download for the whole review,
// and every file after that is answered from what it kept — a review is priced
// at one request, not at its file count. The download is walked as it arrives
// and cancelled the moment every changed file is in hand. `/api/file` stays as
// the per-file fallback, reached when the archive failed, ran past a cap, or
// never held the path — a deleted file, a ref that moved. The archive's own
// failures are silent on purpose: the fallback is the path that already knows
// how to speak, and a reviewer should hear one explanation, not two.
//
// The switch in the header's display menu is `archiveEnabled`. Off means every
// press pays for its own file, which is what a reviewer on a metered
// connection wants from a repository whose archive outweighs the few files
// they will actually expand.
//
// Either way the old side is rebuilt from the new one and the patch. See
// `src/lib/diffHydration.ts` for why that is exact.

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
  /**
   * Every changed file's new-side path, unfiltered — the archive is fetched
   * once and has to carry the files the current filter hides. Deleted files
   * are the caller's to leave out: their path is not in the head commit, and
   * a path that can never be found would keep the download running to the end.
   */
  paths: readonly string[];
  /** False sends every press down the per-file path and downloads no archive. */
  archiveEnabled: boolean;
}): DiffFileLoader {
  const { archiveEnabled, target, token, paths } = options;
  const [error, setError] = useState<string | undefined>(undefined);
  // A string, not the target: the route's loader re-runs and hands down a new
  // object for the same review.
  const query = reviewTargetQuery(target).toString();

  // One archive per review and token, started by the first expansion and
  // shared by every one after it. A failure resolves to nothing rather than
  // rejecting, so each file falls back on its own without a second download.
  const archiveRef = useRef<
    | { key: string; files: Promise<ArchiveFileCollector | undefined> }
    | undefined
  >(undefined);

  const loadDiffFiles = useCallback<FileDiffContentsLoader>(
    async (fileDiff: FileDiffMetadata) => {
      const key = `${query}\u0000${token ?? ''}`;
      if (archiveEnabled && archiveRef.current?.key !== key) {
        archiveRef.current = {
          key,
          files: fetchArchiveFiles(query, token, paths).catch(() => undefined),
        };
      }
      try {
        const contents = await fetchFileContents(
          archiveEnabled ? archiveRef.current?.files : undefined,
          query,
          fileDiff.name,
          token
        );
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
    [archiveEnabled, paths, query, token]
  );

  const dismissError = useCallback(() => setError(undefined), []);

  return { loadDiffFiles, error, dismissError };
}

async function fetchFileContents(
  archive: Promise<ArchiveFileCollector | undefined> | undefined,
  query: string,
  path: string,
  token: string | undefined
): Promise<string> {
  const collector = await archive;
  if (collector != null) {
    const found = collector.take(path);
    if (found.kind === 'file') return found.text;
    // Known too large from the tar header alone — the same answer a request
    // would have bought, without the request.
    if (found.kind === 'too-large') throw new Error(FILE_TOO_LARGE);
  }
  return fetchFile(query, path, token);
}

/**
 * Downloads the review's archive and walks it as it arrives: counted before
 * the gzip so the cap is about the bytes on the wire, decompressed by the
 * browser's own stream, read entry by entry, and cancelled early when every
 * wanted path has been settled.
 */
async function fetchArchiveFiles(
  query: string,
  token: string | undefined,
  paths: readonly string[]
): Promise<ArchiveFileCollector> {
  const collector = new ArchiveFileCollector({
    paths,
    maxFileBytes: MAX_FILE_BYTES,
    maxKeptBytes: MAX_ARCHIVE_KEPT_BYTES,
  });
  // A review of nothing but deletions wants no file at all.
  if (collector.done) return collector;

  const response = await fetch(`/api/archive?${query}`, withGitHubToken(token));
  if (!response.ok) {
    void response.body?.cancel();
    throw new Error(`Archive request failed (${response.status}).`);
  }
  const body = response.body;
  if (body == null) {
    throw new Error('The archive response has no body to stream.');
  }

  let downloaded = 0;
  const counted = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        downloaded += chunk.byteLength;
        if (downloaded > MAX_ARCHIVE_DOWNLOAD_BYTES) {
          throw new Error('That archive is too large to read.');
        }
        controller.enqueue(chunk);
      },
    })
  );
  // The lib types DecompressionStream's writable as taking any BufferSource,
  // which pipeThrough's invariant generics refuse; the stream itself both
  // accepts and yields Uint8Array.
  const gunzip = new DecompressionStream('gzip') as unknown as TransformStream<
    Uint8Array,
    Uint8Array
  >;
  const reader = counted.pipeThrough(gunzip).getReader();
  const tar = new TarReader(collector);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        tar.end();
        break;
      }
      tar.push(value);
      if (collector.done) break;
    }
  } finally {
    // Releases the lock on the way out, and cancels the rest of the download
    // when the loop broke early rather than the body having ended.
    await reader.cancel().catch(() => undefined);
  }
  return collector;
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
