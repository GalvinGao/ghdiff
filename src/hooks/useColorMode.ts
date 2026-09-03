import { useEffect, useSyncExternalStore } from 'react';

import { colorModePreference, usePreference } from './preferences';
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

export interface ColorModeState {
  mode: ColorMode;
  scheme: ColorScheme;
  setMode(mode: ColorMode): void;
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
 */
export function useColorMode(): ColorModeState {
  const {
    value: mode,
    hydrated,
    setValue: setMode,
  } = usePreference(colorModePreference);
  const systemScheme = useSystemScheme();
  const scheme = mode === 'system' ? systemScheme : mode;

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.dataset.colorScheme = scheme;
    document.documentElement.dataset.colorMode = mode;
  }, [hydrated, mode, scheme]);

  return { mode, scheme, setMode, hydrated };
}
