'use client';

import { useCallback, useEffect, useState } from 'react';

import { readStoredString, writeStoredString } from './useLocalStorage';
import { COLOR_MODE_STORAGE_KEY } from '@/lib/storageKeys';

export type ColorMode = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function systemScheme(): ColorScheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

function isColorMode(value: string | null): value is ColorMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

export interface ColorModeState {
  mode: ColorMode;
  scheme: ColorScheme;
  setMode(mode: ColorMode): void;
  /** True once the stored choice has been read on the client. */
  hydrated: boolean;
}

/**
 * Owns the app color mode. ColorModeScript already applied the stored value
 * before paint; this hook takes over the same attribute and keeps it current
 * when the system scheme changes.
 */
export function useColorMode(): ColorModeState {
  const [mode, setModeState] = useState<ColorMode>('system');
  const [scheme, setScheme] = useState<ColorScheme>('light');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = readStoredString(COLOR_MODE_STORAGE_KEY);
    const initial: ColorMode = isColorMode(stored) ? stored : 'system';
    setModeState(initial);
    setScheme(initial === 'system' ? systemScheme() : initial);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (mode !== 'system') return undefined;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => setScheme(query.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [mode]);

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.dataset.colorScheme = scheme;
    document.documentElement.dataset.colorMode = mode;
  }, [hydrated, mode, scheme]);

  const setMode = useCallback((next: ColorMode) => {
    setModeState(next);
    setScheme(next === 'system' ? systemScheme() : next);
    writeStoredString(COLOR_MODE_STORAGE_KEY, next);
  }, []);

  return { mode, scheme, setMode, hydrated };
}
