import type { GitStatus } from '@pierre/trees';
import { useCallback, useMemo, useState } from 'react';

import { reviewFiltersPreference, usePreference } from '@/hooks/preferences';
import { readStoredString } from '@/hooks/useLocalStorage';
import { REVIEW_FILTERS_PREFERENCE } from '@/lib/preferences';
import type { ReviewFilterState } from '@/lib/reviewFilter';
import { writeReviewFilter } from '@/lib/reviewFilterStore';

export type ReviewFilterUpdate =
  | ReviewFilterState
  | ((state: ReviewFilterState) => ReviewFilterState);

/**
 * The file filter of one diff, read from and written to the browser's store,
 * so the diff opens next time with the filter it was left with.
 *
 * The path query is the one part held here in memory only: the field it is
 * typed in opens empty, and a query nobody can see must not hide files.
 *
 * A stored status this diff does not contain is left out of the answer. The
 * branch moves between visits, and a filter for deleted files on a diff that
 * now deletes nothing would empty both panes with no checkbox on screen to
 * undo it — the menu offers a status only when the diff has two or more.
 */
export function useReviewFilter(
  targetKey: string,
  available: ReadonlySet<GitStatus>
): [ReviewFilterState, (next: ReviewFilterUpdate) => void] {
  const { value: store, setValue } = usePreference(reviewFiltersPreference);
  const [query, setQuery] = useState('');
  const stored = store[targetKey];

  const filter = useMemo<ReviewFilterState>(
    () => ({
      presetIds: new Set(stored?.presets),
      statuses: new Set(
        available.size > 1
          ? stored?.statuses.filter((status) => available.has(status))
          : undefined
      ),
      query,
      hideUntracked: stored?.hideUntracked ?? false,
    }),
    [available, query, stored]
  );

  const setFilter = useCallback(
    (update: ReviewFilterUpdate) => {
      const next = typeof update === 'function' ? update(filter) : update;
      setQuery(next.query);
      // A keystroke in the path field changes nothing kept, and is not a
      // reason to rewrite every diff's filter in storage.
      if (
        sameSet(next.presetIds, filter.presetIds) &&
        sameSet(next.statuses, filter.statuses) &&
        next.hideUntracked === filter.hideUntracked
      ) {
        return;
      }
      // The browser's own copy, read at the press, and not the one this render
      // holds: another tab may have written a different diff's filter a
      // moment ago, before its storage event reached this one, and writing
      // the map this render saw would take that filter away again.
      const raw = readStoredString(REVIEW_FILTERS_PREFERENCE.key);
      const latest =
        (raw == null ? undefined : REVIEW_FILTERS_PREFERENCE.decode(raw)) ??
        store;
      setValue(
        writeReviewFilter(latest, targetKey, {
          presets: [...next.presetIds],
          statuses: [...next.statuses],
          hideUntracked: next.hideUntracked,
        })
      );
    },
    [filter, setValue, store, targetKey]
  );

  return [filter, setFilter];
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}
