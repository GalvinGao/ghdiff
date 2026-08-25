import type { CodeViewDiffItem } from '@pierre/diffs';
import type { GitStatus, GitStatusEntry } from '@pierre/trees';

import type { CommentMetadata } from './comments.ts';
import {
  DEFAULT_FILTER_PRESET_ID,
  type FilterPresetId,
  getFilterPreset,
} from './filterRules.ts';
import {
  gitStatusEntries,
  type ReviewData,
  type ReviewFileEntry,
} from './reviewData.ts';

export interface ReviewFilterState {
  /** One preset at a time. 'all' means the path rules pass everything. */
  presetId: FilterPresetId;
  /** Git statuses to keep. An empty set means "keep every status". */
  statuses: ReadonlySet<GitStatus>;
  /** Case-insensitive substring match on the path. Empty means no match test. */
  query: string;
}

export const EMPTY_FILTER_STATE: ReviewFilterState = {
  presetId: DEFAULT_FILTER_PRESET_ID,
  statuses: new Set(),
  query: '',
};

/** The tree consumes paths, not items, so it gets its own projection. */
export interface ReviewTreeSource {
  paths: readonly string[];
  gitStatus: readonly GitStatusEntry[];
  itemIdByPath: ReadonlyMap<string, string>;
}

export interface FilteredReviewData {
  items: readonly CodeViewDiffItem<CommentMetadata>[];
  entries: readonly ReviewFileEntry[];
  treeSource: ReviewTreeSource;
  /** How many files the filter removed. Drives the "N hidden" chip. */
  hiddenCount: number;
}

export function isFilterActive(state: ReviewFilterState): boolean {
  return (
    state.presetId !== DEFAULT_FILTER_PRESET_ID ||
    state.statuses.size > 0 ||
    state.query.trim().length > 0
  );
}

/** The git statuses actually present in this diff, for the status menu. */
export function availableStatuses(
  entries: readonly ReviewFileEntry[]
): Set<GitStatus> {
  return new Set(entries.map((entry) => entry.status));
}

/**
 * How many files each preset would keep. The menu shows these counts so the
 * user can see that "Tests only" is worth picking before picking it.
 */
export function presetMatchCounts(
  entries: readonly ReviewFileEntry[],
  presetIds: readonly FilterPresetId[]
): Map<FilterPresetId, number> {
  const counts = new Map<FilterPresetId, number>();
  for (const id of presetIds) {
    const preset = getFilterPreset(id);
    let count = 0;
    for (const entry of entries) {
      if (preset.matches(entry.path)) count++;
    }
    counts.set(id, count);
  }
  return counts;
}

export function applyReviewFilter(
  data: ReviewData,
  state: ReviewFilterState
): FilteredReviewData {
  const preset = getFilterPreset(state.presetId);
  const query = state.query.trim().toLowerCase();
  const itemById = new Map(data.items.map((item) => [item.id, item]));

  const entries: ReviewFileEntry[] = [];
  const items: CodeViewDiffItem<CommentMetadata>[] = [];
  const paths: string[] = [];
  const itemIdByPath = new Map<string, string>();

  for (const entry of data.entries) {
    if (!preset.matches(entry.path)) continue;
    if (state.statuses.size > 0 && !state.statuses.has(entry.status)) continue;
    if (query.length > 0 && !entry.path.toLowerCase().includes(query)) continue;

    const item = itemById.get(entry.itemId);
    if (item == null) continue;

    entries.push(entry);
    items.push(item);
    paths.push(entry.treePath);
    itemIdByPath.set(entry.treePath, entry.itemId);
  }

  return {
    items,
    entries,
    treeSource: {
      paths,
      gitStatus: gitStatusEntries(entries),
      itemIdByPath,
    },
    hiddenCount: data.entries.length - entries.length,
  };
}
