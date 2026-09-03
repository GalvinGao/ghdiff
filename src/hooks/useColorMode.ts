import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

import { colorModePreference, usePreference } from './preferences';
import {
  applyColorSchemeWithWipe,
  type WipeOrigin,
} from '@/lib/colorSchemeWipe';
import type { ColorMode } from '@/lib/preferences';

export type { ColorMode };
export type ColorScheme = 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribeToSystemScheme(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * The scheme the platform asks for. The server has no window and answers
 * `light`, which React uses for the hydrating render as well, so the markup it
 * is matching against cannot disagree with it.
 */
function useSystemScheme(): ColorScheme {
  return useSyncExternalStore(
    subscribeToSystemScheme,
    () => (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'),
    () => 'light'
  );
}

/** The two attributes the whole app reads, written as one. */
function writeSchemeAttributes(mode: ColorMode, scheme: ColorScheme): void {
  document.documentElement.dataset.colorScheme = scheme;
  document.documentElement.dataset.colorMode = mode;
}

export interface ColorModeState {
  mode: ColorMode;
  scheme: ColorScheme;
  /**
   * Stores a mode. Given the coordinates of the press that asked for it, the
   * new scheme is wiped in from there rather than swapped in whole — see
   * `src/lib/colorSchemeWipe.ts`.
   */
  setMode(mode: ColorMode, origin?: WipeOrigin): void;
  /** True once the stored choice has been read on the client. */
  hydrated: boolean;
}

/**
 * Owns the app colour mode. ColorModeScript already applied the stored value
 * before paint; this hook takes over the same attributes and keeps them current
 * when the platform's scheme changes, and when another tab picks a mode.
 *
 * The scheme is derived and not held: `system` is an answer about where to look
 * rather than a colour, so a mode arriving from another tab and a platform that
 * turns dark at sunset both reach the attribute the same way.
 *
 * Which is also why the wipe is this hook's and not the control's. Resolving a
 * mode to a scheme needs the platform's own answer, and the hook is the one
 * place that already has it: the control knows which mode it is asking for and
 * cannot know whether that changes anything on screen.
 */
export function useColorMode(): ColorModeState {
  const {
    value: mode,
    hydrated,
    setValue: storeMode,
  } = usePreference(colorModePreference);
  const systemScheme = useSystemScheme();
  const scheme = mode === 'system' ? systemScheme : mode;

  useEffect(() => {
    if (!hydrated) return;
    writeSchemeAttributes(mode, scheme);
  }, [hydrated, mode, scheme]);

  const setMode = useCallback(
    (next: ColorMode, origin?: WipeOrigin) => {
      const nextScheme = next === 'system' ? systemScheme : next;
      // The attributes are written here rather than left to the effect above,
      // and the store write is flushed, because a view transition captures the
      // page the moment this callback returns. The effect runs after that, and
      // the two props the scheme reaches by render — the tree's own scheme and
      // the viewer's theme — would be captured in their old state and pop into
      // place once the wipe had finished. The effect then writes the same two
      // values a second time, which changes nothing.
      const apply = () => {
        writeSchemeAttributes(next, nextScheme);
        flushSync(() => storeMode(next));
      };
      if (origin === undefined) {
        apply();
        return;
      }
      applyColorSchemeWithWipe({
        apply,
        changesScheme: nextScheme !== scheme,
        origin,
      });
    },
    [scheme, storeMode, systemScheme]
  );

  return { mode, scheme, setMode, hydrated };
}
