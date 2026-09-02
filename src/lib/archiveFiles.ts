// What the review keeps out of an archive, and what it refuses.
//
// One tar.gz of the head commit's worktree carries the new side of every
// changed file, and this collector is the sink that walks it: it keeps the
// paths the diff names, skips the rest of the repository unread, and answers
// the loader afterwards, one file at a time. The paths in an archive open with
// the root directory GitHub names after the repository and the ref, so every
// comparison here happens on the path with that first segment cut off.
//
// Three refusals, each deliberate. A wanted file larger than the per-file
// ceiling is remembered as too large, so the loader can say so without
// spending a request to find out. A file that would take the kept total past
// its ceiling is dropped and left for the per-file fallback, which only pays
// for it if the reviewer actually expands it. And a path the archive never
// held — a deleted file, a ref that moved — is simply missing, which sends the
// loader down the same fallback.

import type { TarEntryHeader, TarSink } from './tar.ts';

/**
 * Stop the download past this many compressed bytes. The figure is about the
 * repository, not the diff: ghostty's whole worktree travels as 39 MB, and a
 * repository whose archive runs past this is one whose changed files are
 * cheaper to fetch one by one.
 */
export const MAX_ARCHIVE_DOWNLOAD_BYTES = 256 * 1024 * 1024;

/**
 * Stop keeping files past this many decoded bytes. Each kept file is already
 * capped at MAX_FILE_BYTES; this is the guard for a review with thousands of
 * them. What is dropped falls back to a per-file request, paid only when the
 * reviewer expands that file.
 */
export const MAX_ARCHIVE_KEPT_BYTES = 128 * 1024 * 1024;

export type ArchiveFileResult =
  | { kind: 'file'; text: string }
  | { kind: 'too-large' }
  | { kind: 'missing' };

export class ArchiveFileCollector implements TarSink {
  /** The paths still being looked for. Empty is what ends the download. */
  private readonly wanted: Set<string>;
  private readonly files = new Map<string, string>();
  private readonly tooLargePaths = new Set<string>();
  private readonly maxFileBytes: number;
  private readonly maxKeptBytes: number;
  private keptBytes = 0;

  constructor(options: {
    /** Repo-relative paths, without the archive's root directory. */
    paths: Iterable<string>;
    maxFileBytes: number;
    maxKeptBytes: number;
  }) {
    this.wanted = new Set(options.paths);
    this.maxFileBytes = options.maxFileBytes;
    this.maxKeptBytes = options.maxKeptBytes;
  }

  wants(header: TarEntryHeader): boolean {
    const path = innerPath(header.path);
    if (path == null || !this.wanted.has(path)) return false;
    if (header.size > this.maxFileBytes) {
      this.wanted.delete(path);
      this.tooLargePaths.add(path);
      return false;
    }
    if (this.keptBytes + header.size > this.maxKeptBytes) {
      this.wanted.delete(path);
      return false;
    }
    return true;
  }

  onFile(path: string, bytes: Uint8Array): void {
    const inner = innerPath(path);
    if (inner == null || !this.wanted.delete(inner)) return;
    this.keptBytes += bytes.byteLength;
    this.files.set(inner, new TextDecoder().decode(bytes));
  }

  /** True once every wanted path is settled. The download can stop here. */
  get done(): boolean {
    return this.wanted.size === 0;
  }

  /**
   * The file's text, handed over once: the library hydrates a file a single
   * time, so a copy kept after this call would only be memory.
   */
  take(path: string): ArchiveFileResult {
    const text = this.files.get(path);
    if (text != null) {
      this.files.delete(path);
      return { kind: 'file', text };
    }
    if (this.tooLargePaths.has(path)) return { kind: 'too-large' };
    return { kind: 'missing' };
  }
}

/** The path without the archive's root directory, or nothing for the root. */
function innerPath(path: string): string | undefined {
  const slash = path.indexOf('/');
  if (slash < 0 || slash === path.length - 1) return undefined;
  return path.slice(slash + 1);
}
