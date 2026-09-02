import { atom, useAtomValue, useSetAtom, type WritableAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { useMemo } from 'react';

import {
  isLocalStorageArea,
  readStoredString,
  writeStoredString,
} from './useLocalStorage';
import {
  ARCHIVE_HYDRATION_PREFERENCE,
  CODE_FONT_PREFERENCE,
  COLOR_MODE_PREFERENCE,
  COMMENT_AUTHOR_FILTER_PREFERENCE,
  GITHUB_TOKEN_PREFERENCE,
  type PreferenceCodec,
  RAIL_COLLAPSED_PREFERENCE,
  RAIL_WIDTH_PREFERENCE,
  SIDEBAR_WIDTH_PREFERENCE,
  VIEWER_CONTROLS_PREFERENCE,
  WATCHED_REPOS_PREFERENCE,
} from '@/lib/preferences';

// One store for the settings, and one copy of each of them.
//
// Every setting the app remembers is a jotai atom over the key its codec names.
// Three things follow from that, and each of them was a bug or a rule before it:
//
// A setting has one owner. A hook that read storage into `useState` owned a
// copy of what it read, so two components calling it disagreed the moment one
// of them wrote — which is why the token, the colour mode, the code font and
// the watch list had to be mounted once, above the app, and handed down. An
// atom is the owner instead: the bar and the diff read the same one, and a
// component may read a setting where it needs it.
//
// A setting follows the reviewer's other tabs. `atomWithStorage` subscribes
// through the storage this module hands it, and a `storage` event is what one
// tab hears when another writes. A reviewer with a diff open in four tabs
// changes the code font once. This is also the one case the flash rules do not
// cover: `data-color-scheme`, `data-code-font` and `data-watching` are written
// by effects that watch these values, so a change from another tab carries into
// the document the same way the reviewer's own press does.
//
// And a setting is `undefined` until the browser's copy has been read. Storage
// is read on mount and never during a render, so the server's markup and the
// first client render agree, and `hydrated` is what a control asks when the
// difference matters: an unread watch list and an empty one are the same value
// and not the same answer.

/**
 * A setting's atom. The value is `undefined` before the read, and a write
 * takes the value alone — `atomWithStorage`'s own `RESET` is deliberately not
 * reachable, because it would set the atom back to `undefined` and tell every
 * reader the browser's copy had never been read.
 */
export type PreferenceAtom<T> = WritableAtom<T | undefined, [T], void>;

export interface PreferenceHandle<T> {
  atom: PreferenceAtom<T>;
  fallback: T;
}

export interface Preference<T> {
  value: T;
  /** True once the browser's own copy has been read. */
  hydrated: boolean;
  setValue(next: T): void;
}

/**
 * What `atomWithStorage` asks a synchronous store for. jotai declares this
 * shape as `SyncStorage` and re-exports neither it nor the module it is in, so
 * it is stated here rather than reached for through a path that is nobody's
 * public API. The three methods and the subscription are the whole contract.
 */
interface PreferenceStorage<T> {
  getItem(key: string, initialValue: T | undefined): T | undefined;
  setItem(key: string, value: T | undefined): void;
  removeItem(key: string): void;
  subscribe(
    key: string,
    callback: (value: T | undefined) => void
  ): (() => void) | undefined;
}

/**
 * The storage `atomWithStorage` reads and subscribes through, for one setting.
 *
 * `getItem` never answers `undefined`: after the read a setting holds either
 * what the browser kept or the codec's fallback, so `undefined` means the read
 * itself has not happened. A `storage` event with no key at all is a
 * `clear()` — in another tab, or from the devtools — and reads as the fallback,
 * which is the truth about a store that no longer holds the value.
 */
function preferenceStorage<T>(codec: PreferenceCodec<T>): PreferenceStorage<T> {
  const read = (raw: string | null): T =>
    (raw == null ? undefined : codec.decode(raw)) ?? codec.fallback;

  return {
    getItem: () => read(readStoredString(codec.key)),
    setItem: (_key, value) => {
      if (value === undefined) return;
      writeStoredString(codec.key, codec.encode(value));
    },
    removeItem: () => writeStoredString(codec.key, null),
    subscribe: (_key, callback) => {
      if (typeof globalThis.addEventListener !== 'function') return undefined;
      const onStorage = (event: StorageEvent) => {
        if (event.key != null && event.key !== codec.key) return;
        if (!isLocalStorageArea(event.storageArea)) return;
        callback(read(event.newValue));
      };
      globalThis.addEventListener('storage', onStorage);
      return () => globalThis.removeEventListener('storage', onStorage);
    },
  };
}

/** Builds the atom for one setting, and keeps its fallback beside it. */
function preference<T>(codec: PreferenceCodec<T>): PreferenceHandle<T> {
  const stored = atomWithStorage<T | undefined>(
    codec.key,
    undefined,
    preferenceStorage(codec)
  );
  return {
    atom: atom(
      (get) => get(stored),
      (_get, set, next: T) => {
        set(stored, next);
      }
    ),
    fallback: codec.fallback,
  };
}

/** Reads one setting, and writes it to storage and to every other tab. */
export function usePreference<T>(handle: PreferenceHandle<T>): Preference<T> {
  const stored = useAtomValue(handle.atom);
  const setValue = useSetAtom(handle.atom);
  return useMemo(
    () => ({
      value: stored ?? handle.fallback,
      hydrated: stored !== undefined,
      setValue,
    }),
    [handle.fallback, setValue, stored]
  );
}

export const colorModePreference = preference(COLOR_MODE_PREFERENCE);
export const codeFontPreference = preference(CODE_FONT_PREFERENCE);
export const gitHubTokenPreference = preference(GITHUB_TOKEN_PREFERENCE);
export const watchedReposPreference = preference(WATCHED_REPOS_PREFERENCE);
export const viewerControlsPreference = preference(VIEWER_CONTROLS_PREFERENCE);
export const railCollapsedPreference = preference(RAIL_COLLAPSED_PREFERENCE);
export const commentAuthorFilterPreference = preference(
  COMMENT_AUTHOR_FILTER_PREFERENCE
);
export const sidebarWidthPreference = preference(SIDEBAR_WIDTH_PREFERENCE);
export const railWidthPreference = preference(RAIL_WIDTH_PREFERENCE);
export const archiveHydrationPreference = preference(
  ARCHIVE_HYDRATION_PREFERENCE
);
