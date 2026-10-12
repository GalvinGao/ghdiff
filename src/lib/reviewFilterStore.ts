import type { GitStatus } from '@pierre/trees';

import { type FilterPresetId, isFilterPresetId } from './filterRules';

// The filter a reviewer left on each diff, so the next visit opens with it.
//
// A pull request read over several days is read with the same eyes each time —
// source and tests, say, and never the lock file — so the filter belongs to the
// diff and not to the visit. It is kept per review target, under
// `reviewTargetKey`, and the path query is left out: a query belongs to the
// field it was typed in, and that field opens empty, so a stored query would
// hide files behind a control nobody can see.
//
// This module stays free of any browser-only import, because the preference
// codecs in `preferences.ts` that read it are part of a server module graph.

/** What one diff remembers. Every field is the default when absent. */
export interface StoredReviewFilter {
  presets: readonly FilterPresetId[];
  statuses: readonly GitStatus[];
  hideUntracked: boolean;
}

/** Every diff's stored filter, by `reviewTargetKey`, oldest write first. */
export type ReviewFilterStore = Readonly<Record<string, StoredReviewFilter>>;

export const EMPTY_REVIEW_FILTER_STORE: ReviewFilterStore = {};

/**
 * How many diffs keep a filter. A row is under a hundred bytes and only a
 * filter that hides something is written, but a reviewer opens pull requests
 * for years, so the oldest write goes when the store is full.
 */
export const MAX_STORED_REVIEW_FILTERS = 500;

/** The statuses the filter menu offers. Untracked has a switch of its own. */
const STORED_STATUSES: ReadonlySet<string> = new Set([
  'added',
  'modified',
  'renamed',
  'deleted',
]);

function isStoredStatus(value: unknown): value is GitStatus {
  return typeof value === 'string' && STORED_STATUSES.has(value);
}

function acceptEntry(value: unknown): StoredReviewFilter | undefined {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const presets = Array.isArray(raw.presets)
    ? (raw.presets as unknown[]).filter(
        (id): id is FilterPresetId =>
          typeof id === 'string' && isFilterPresetId(id)
      )
    : [];
  const statuses = Array.isArray(raw.statuses)
    ? (raw.statuses as unknown[]).filter(isStoredStatus)
    : [];
  const entry: StoredReviewFilter = {
    presets: [...new Set(presets)],
    statuses: [...new Set(statuses)],
    hideUntracked: raw.hideUntracked === true,
  };
  return isDefault(entry) ? undefined : entry;
}

/**
 * Reads the store back. One row this build cannot read is dropped and the rest
 * kept, and a value that is not an object at all is refused.
 */
export function acceptReviewFilterStore(
  value: unknown
): ReviewFilterStore | undefined {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    return undefined;
  }
  const store: Record<string, StoredReviewFilter> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const entry = acceptEntry(raw);
    if (entry != null) store[key] = entry;
  }
  return store;
}

function isDefault(entry: StoredReviewFilter): boolean {
  return (
    entry.presets.length === 0 &&
    entry.statuses.length === 0 &&
    !entry.hideUntracked
  );
}

/**
 * The store with one diff's filter written. A filter that hides nothing is
 * removed rather than kept, and a write moves its row to the end, so the row
 * the cap drops is the one written longest ago.
 */
export function writeReviewFilter(
  store: ReviewFilterStore,
  key: string,
  entry: StoredReviewFilter
): ReviewFilterStore {
  const next: Record<string, StoredReviewFilter> = { ...store };
  delete next[key];
  if (!isDefault(entry)) next[key] = entry;
  const keys = Object.keys(next);
  const over = keys.length - MAX_STORED_REVIEW_FILTERS;
  for (let index = 0; index < over; index++) delete next[keys[index]];
  return next;
}
