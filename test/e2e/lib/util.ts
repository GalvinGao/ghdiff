// Small helpers shared by both e2e suites: the required environment read and
// the ISO-date check.

/** RFC 3339's date-time: `Date.parse` alone would also take `10/14/2026`. */
const RFC_3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export const isIsoDate = (s: unknown): s is string =>
  typeof s === 'string' && RFC_3339.test(s) && !Number.isNaN(Date.parse(s));

/**
 * The markers this suite writes: `MARK` (`[e2e ` and a 13-digit millisecond
 * clock), and the two an older probe wrote. Anchored and closed, so a human's
 * `[e2e planning]` is never taken for one before a delete.
 */
export const MARKED = /^\[(?:e2e \d{13}|rpc-test|probe)\]/;

/**
 * An environment variable the suite cannot run without. Absent is a loud
 * failure at import, naming the variable — a missing credential is not a
 * state to limp through.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value == null || value === '') {
    throw new Error(`${name} is not set — export it and run the suite again.`);
  }
  return value;
}
