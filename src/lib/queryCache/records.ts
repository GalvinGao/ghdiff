// What one cached answer looks like in IndexedDB, and the rules that decide
// whether a tab may still read it.
//
// Every answer in the shared cache belongs to an account. GitHub answers the
// same question differently for a signed-in reviewer and for nobody — the
// status square's axes, a private repository's pull requests — so a record is
// filed under the account that asked, and a tab reads only the records of the
// account it has confirmed. The cookie is shared by every tab of the browser,
// so in practice that is one account at a time, and `SharedCache` keeps the
// store to exactly one: confirming another account deletes the rest.

/**
 * Raised whenever a procedure's output changes shape. A record written by an
 * older build is then refused as a whole rather than handed to a component
 * that expects a field it does not carry. Deliberately not the commit sha: that
 * would empty every reviewer's cache on every deploy.
 */
export const CACHE_SCHEMA_VERSION = 1;

/**
 * How long a record may be read after it was written. A cache that outlived a
 * day would be private repository content sitting on a disk for no gain: by then
 * every answer in it is stale enough to be fetched again anyway.
 */
export const CACHE_MAX_AGE_MS = 24 * 60 * 60_000;

/**
 * How young an answer another tab fetched has to be for this tab to take it
 * instead of asking GitHub again. It covers the burst a reviewer causes by
 * opening several pull requests at once, and a reload pressed straight after
 * another tab's.
 */
export const SHARE_WINDOW_MS = 5_000;

/** The account a session's answers are filed under. */
export const ANONYMOUS_NAMESPACE = 'anonymous';

export function viewerNamespace(login: string | undefined): string {
  return login == null ? ANONYMOUS_NAMESPACE : `user:${login.toLowerCase()}`;
}

export interface CacheRecord {
  /** `namespace` and `hash` together, so two accounts never share a record. */
  id: string;
  namespace: string;
  hash: string;
  queryKey: readonly unknown[];
  version: number;
  /** When the tab that fetched the answer received it. */
  updatedAt: number;
  /**
   * False when what was stored is less than what was fetched — an answer with
   * its signed attachment addresses taken out, which must never stand in for a
   * fresh fetch.
   */
  complete: boolean;
  data: unknown;
}

/**
 * The one string a query key is known by, across tabs and in the store. Every
 * key in this app is an array of strings, numbers and booleans, so JSON is an
 * exact encoding of it.
 */
export function queryHash(queryKey: readonly unknown[]): string {
  return JSON.stringify(queryKey);
}

export function recordId(namespace: string, hash: string): string {
  return `${namespace}\n${hash}`;
}

/**
 * Whether a value read back out of the store is a record this build may use. It
 * arrives from disk, where an older build or a hand edit could have left
 * anything, so the shape is checked as well as the version and the age.
 */
export function isLiveRecord(
  value: unknown,
  now: number
): value is CacheRecord {
  if (typeof value !== 'object' || value == null) return false;
  const record = value as Partial<CacheRecord>;
  return (
    typeof record.id === 'string' &&
    typeof record.namespace === 'string' &&
    typeof record.hash === 'string' &&
    Array.isArray(record.queryKey) &&
    record.version === CACHE_SCHEMA_VERSION &&
    typeof record.updatedAt === 'number' &&
    typeof record.complete === 'boolean' &&
    record.data !== undefined &&
    now - record.updatedAt < CACHE_MAX_AGE_MS
  );
}

/**
 * Whether an answer received at `updatedAt` is young enough to take in place
 * of a fetch. A time in the future is refused: every tab reads the same clock,
 * so one can only come from a record this build did not write.
 */
export function isWithinWindow(
  updatedAt: number,
  now: number,
  windowMs: number
): boolean {
  return updatedAt <= now && now - updatedAt < windowMs;
}

let lastMoment = 0;

/**
 * A moment on the wall clock, finer than a millisecond and never the same
 * twice in one tab. Answers are ordered by the moment their fetch began, and
 * two fetches that began in the same millisecond would otherwise tie — which
 * is exactly the case where the order matters. Another tab's moments are on
 * the same clock to within a millisecond, which is all a comparison across
 * tabs needs.
 */
export function moment(): number {
  const now =
    typeof performance === 'undefined'
      ? Date.now()
      : performance.timeOrigin + performance.now();
  lastMoment = Math.max(now, lastMoment + 0.001);
  return lastMoment;
}
