'use client';

import { useCallback, useEffect, useState } from 'react';

// Reads on mount rather than during the first render, so the server markup and
// the first client render agree. Every access is guarded: storage throws in a
// private window and when the browser blocks site data.

export function readStoredString(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStoredString(key: string, value: string | null): void {
  try {
    if (value == null) {
      globalThis.localStorage?.removeItem(key);
    } else {
      globalThis.localStorage?.setItem(key, value);
    }
  } catch {
    // Storage is unavailable. The value stays in memory for this page only.
  }
}

export function readStoredJson<T>(key: string, fallback: T): T {
  const raw = readStoredString(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * A JSON value in local storage. `hydrated` tells the caller whether the stored
 * value has been read yet, so the UI can hold back a control until it knows.
 */
export function useStoredJson<T>(
  key: string,
  fallback: T
): {
  value: T;
  setValue: (next: T) => void;
  hydrated: boolean;
} {
  const [value, setStateValue] = useState<T>(fallback);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setStateValue(readStoredJson(key, fallback));
    setHydrated(true);
    // `fallback` is a literal at every call site, so it is deliberately not a
    // dependency: including it would re-read storage on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setValue = useCallback(
    (next: T) => {
      setStateValue(next);
      writeStoredString(key, JSON.stringify(next));
    },
    [key]
  );

  return { value, setValue, hydrated };
}
