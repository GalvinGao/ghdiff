import { useCallback, useMemo } from 'react';

import { repoLensesPreference, usePreference } from '@/hooks/preferences';
import {
  type LensId,
  type LensSettingsById,
  lensSettings,
  type RepoLensSettings,
  repoLensKey,
} from '@/lib/lenses/lenses';
import type { ReviewTarget } from '@/lib/reviewTarget';

export interface RepoLenses {
  /** The repository's own settings, or nothing when it has none yet. */
  settings: RepoLensSettings | undefined;
  hydrated: boolean;
  /** One lens's settings for this repository, with the defaults filled in. */
  get<Id extends LensId>(id: Id): LensSettingsById[Id];
  set<Id extends LensId>(id: Id, next: LensSettingsById[Id]): void;
}

/**
 * The lens settings of the repository under review.
 *
 * Every repository shares one stored value, so a write here rewrites the whole
 * store with this repository's entry replaced. The key is derived from the
 * target's strings rather than the target object, whose identity changes on
 * every loader run.
 */
export function useRepoLenses(target: ReviewTarget): RepoLenses {
  const {
    value: store,
    hydrated,
    setValue,
  } = usePreference(repoLensesPreference);
  const key = repoLensKey(target);
  const settings = store[key];

  const get = useCallback(
    <Id extends LensId>(id: Id) => lensSettings(settings, id),
    [settings]
  );
  const set = useCallback(
    <Id extends LensId>(id: Id, next: LensSettingsById[Id]) => {
      setValue({ ...store, [key]: { ...store[key], [id]: next } });
    },
    [key, setValue, store]
  );

  return useMemo(
    () => ({ settings, hydrated, get, set }),
    [get, hydrated, set, settings]
  );
}
