// One status for a spent quota, out of the three GitHub answers with.
//
// The REST API reports the primary rate limit as 403 and a secondary one as
// 429; the web diff host reports 429. A 403 is also the answer to a repository
// the caller cannot see and to a request that names no user agent, so the
// status on its own cannot be read as "wait and try again". The headers are
// what separate them: GitHub sends `retry-after` when it throttles a burst and
// `x-ratelimit-remaining: 0` when the hour's quota is gone.
//
// Normalizing here is what lets every caller downstream hold one rule. Without
// it the review panel would have to ask whether a 403 means "sign in", "you
// cannot see this", or "you asked too often".

/** The one status this app reports for a spent quota. */
export const RATE_LIMITED_STATUS = 429;

/** Whether a reported status means the caller has no quota left. */
export function isRateLimited(status: number | undefined): boolean {
  return status === RATE_LIMITED_STATUS;
}

/** The status to report for a failed GitHub response. */
export function rateLimitedStatus(status: number, headers: Headers): number {
  if (status === RATE_LIMITED_STATUS) return RATE_LIMITED_STATUS;
  if (status !== 403) return status;
  if (headers.get('retry-after') != null) return RATE_LIMITED_STATUS;
  return headers.get('x-ratelimit-remaining') === '0'
    ? RATE_LIMITED_STATUS
    : status;
}
