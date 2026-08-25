import {
  type ChangeTypes,
  type CodeViewDiffItem,
  type FileDiffMetadata,
  parsePatchFiles,
} from '@pierre/diffs';
import type { GitStatus, GitStatusEntry } from '@pierre/trees';

import type { CommentMetadata } from './comments.ts';

export interface ReviewDiffStats {
  addedLines: number;
  deletedLines: number;
  fileCount: number;
  totalLines: number;
}

/** One changed file, in the order the patch listed it. */
export interface ReviewFileEntry {
  /** Item id in the CodeView. Equals `treePath`. */
  itemId: string;
  /** Repository-relative path, which is what the filter rules read. */
  path: string;
  /** Path shown in the tree. Carries a commit prefix for a multi-commit patch. */
  treePath: string;
  fileOrder: number;
  changeType: ChangeTypes;
  status: GitStatus;
  addedLines: number;
  deletedLines: number;
}

export interface ReviewData {
  items: readonly CodeViewDiffItem<CommentMetadata>[];
  entries: readonly ReviewFileEntry[];
  stats: ReviewDiffStats;
}

export const EMPTY_REVIEW_DATA: ReviewData = {
  items: [],
  entries: [],
  stats: { addedLines: 0, deletedLines: 0, fileCount: 0, totalLines: 0 },
};

/**
 * Translates the diff-level change type from @pierre/diffs into the git-status
 * vocabulary the file tree understands. Both rename variants fold into
 * 'renamed' so the tree shows one rename badge either way.
 */
export function gitStatusFromChangeType(type: ChangeTypes): GitStatus {
  switch (type) {
    case 'new':
      return 'added';
    case 'deleted':
      return 'deleted';
    case 'rename-pure':
    case 'rename-changed':
      return 'renamed';
    case 'change':
      return 'modified';
  }
}

const COMMIT_HASH_PATTERN = /^From\s+([a-f0-9]+)\s/im;

/**
 * A patch file that holds several commits repeats the same paths once per
 * commit. Prefix each commit's files so the tree keeps them apart.
 */
function treePathPrefix(
  patchMetadata: string | undefined,
  patchIndex: number
): string {
  const commitHash = patchMetadata?.match(COMMIT_HASH_PATTERN)?.[1];
  return commitHash != null
    ? commitHash.slice(0, 7)
    : `Commit ${patchIndex + 1}`;
}

function countHunkLines(fileDiff: FileDiffMetadata): {
  added: number;
  deleted: number;
} {
  let added = 0;
  let deleted = 0;
  for (const hunk of fileDiff.hunks) {
    added += hunk.additionLines;
    deleted += hunk.deletionLines;
  }
  return { added, deleted };
}

/**
 * Turns raw patch text into the item list the CodeView renders and the entry
 * list every other panel reads. One linear pass, no streaming: reviewer holds
 * the whole diff in React state so a filter change is a pure array filter.
 */
export function buildReviewData(
  patchContent: string,
  cacheKey: string
): ReviewData {
  const patches = parsePatchFiles(patchContent, encodeURIComponent(cacheKey));
  const prefixPaths = patches.length > 1;

  const items: CodeViewDiffItem<CommentMetadata>[] = [];
  const entries: ReviewFileEntry[] = [];
  const stats: ReviewDiffStats = {
    addedLines: 0,
    deletedLines: 0,
    fileCount: 0,
    totalLines: 0,
  };
  const usedItemIds = new Set<string>();

  for (const [patchIndex, patch] of patches.entries()) {
    const prefix = prefixPaths
      ? treePathPrefix(patch.patchMetadata, patchIndex)
      : undefined;

    for (const fileDiff of patch.files) {
      const path = fileDiff.name;
      const treePath = prefix == null ? path : `${prefix}/${path}`;
      const itemId = uniqueItemId(usedItemIds, treePath);
      const { added, deleted } = countHunkLines(fileDiff);

      items.push({ id: itemId, type: 'diff', fileDiff, version: 0 });
      entries.push({
        itemId,
        path,
        treePath,
        fileOrder: entries.length,
        changeType: fileDiff.type,
        status: gitStatusFromChangeType(fileDiff.type),
        addedLines: added,
        deletedLines: deleted,
      });

      stats.fileCount++;
      stats.addedLines += added;
      stats.deletedLines += deleted;
      stats.totalLines += fileDiff.unifiedLineCount;
    }
  }

  return { items, entries, stats };
}

function uniqueItemId(used: Set<string>, base: string): string {
  if (base.length > 0 && !used.has(base)) {
    used.add(base);
    return base;
  }
  let suffix = 2;
  let candidate = `${base}?${suffix}`;
  while (used.has(candidate)) {
    suffix++;
    candidate = `${base}?${suffix}`;
  }
  used.add(candidate);
  return candidate;
}

/** Git-status entries for the tree. 'modified' is the tree's visual default. */
export function gitStatusEntries(
  entries: readonly ReviewFileEntry[]
): GitStatusEntry[] {
  const result: GitStatusEntry[] = [];
  for (const entry of entries) {
    if (entry.status === 'modified') continue;
    result.push({ path: entry.treePath, status: entry.status });
  }
  return result;
}
