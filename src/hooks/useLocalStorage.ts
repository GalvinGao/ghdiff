// Browser storage, guarded. Every access is in a `try`: storage throws in a
// private window and when the browser blocks site data, and neither is a
// failure the app should report — the value simply stays in memory for this
// page.
//
// Nothing here reads storage during a render. A settings value is read after
// mount, so the server's markup and the first client render agree; see
// `src/hooks/preferences.ts`, which is where the settings themselves live.

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
 * Whether a `StorageEvent` is about local storage.
 *
 * The event is raised for session storage too, and this app writes none, so a
 * listener that skipped the test would answer to a value some other script on
 * the page keeps. The comparison itself is what throws when site data is
 * blocked, so it is guarded like every other access.
 */
export function isLocalStorageArea(area: Storage | null): boolean {
  try {
    return area != null && area === globalThis.localStorage;
  } catch {
    return false;
  }
}
