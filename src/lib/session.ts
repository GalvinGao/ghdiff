// The reviewer's GitHub credential, as it travels between requests.
//
// This is the half of the session with no cipher in it: what the cookie carries,
// what the cookie is called, the two clocks that decide when it is spent, and
// the one rule about where a redirect may land. `@/lib/server/session` is the
// other half, and it is the only module that reads or writes the sealed value.
// The split is the one `servedCount` already makes — pure logic here, where the
// test runner reaches it without a bundler, and the runtime's own API next door.

/** What the sealed cookie carries, and nothing more. */
export interface SessionPayload {
  /** The user-to-server token, `ghu_…`. */
  accessToken: string;
  /**
   * When `accessToken` dies, in Unix milliseconds. Absent when the App has
   * user-to-server expiry turned off: that is the one case where GitHub answers
   * with a token that states no life and hands back no refresh token beside it.
   */
  accessExpiresAt?: number;
  /** The single-use refresh token, `ghr_…`. Absent for a non-expiring App. */
  refreshToken?: string;
  /** When `refreshToken` dies, in Unix milliseconds. */
  refreshExpiresAt?: number;
  /**
   * When this session began, in Unix milliseconds. A refresh carries it forward
   * unchanged, so it dates the sign-in and never the seal. That is what makes
   * the ceiling below an actual ceiling rather than a window that rolls forward
   * every eight hours.
   */
  issuedAt: number;
}

/** What the handoff cookie carries across GitHub's half of the flow. */
export interface OAuthHandoff {
  /** Echoed back by GitHub, and compared to prove the callback is ours. */
  state: string;
  /** The PKCE secret, held here and never sent until the exchange. */
  verifier: string;
  /** Where the reviewer was, fragment included. */
  returnTo: string;
}

// `__Host-` is a prefix the browser enforces rather than a name this app chose.
// A cookie that carries it is refused outright unless it is `Secure`, states
// `Path=/`, and names no `Domain` at all. The last of the three is the one worth
// having: no subdomain of ghdiff.com can write this cookie, so no subdomain can
// fix a session onto a reviewer. `pnpm dev` serves http://localhost, which
// Chrome treats as trustworthy and accepts these on; a browser that refuses
// wants HTTPS locally rather than a second cookie name here.

/** The session itself. */
export const SESSION_COOKIE = '__Host-ghdiff-session';

/** The handoff between the two halves of the authorization flow. */
export const OAUTH_COOKIE = '__Host-ghdiff-oauth';

/**
 * How long a session may live whatever GitHub says. The refresh token is good
 * for six months, and six months is longer than this app has any reason to hold
 * one: a reviewer who has not opened a diff in a month can press the button
 * again. Measured from `issuedAt`.
 */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How far ahead of its stated expiry an access token counts as spent. GitHub's
 * clock and this Worker's are not the same clock, and a token that died between
 * the check and the request would cost the reviewer a failed diff where a
 * refresh would have cost them nothing.
 */
export const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** How long the reviewer has to finish GitHub's own half of the flow. */
export const OAUTH_MAX_AGE_MS = 10 * 60 * 1000;

/** The longest `returnTo` this app will write into a `Location`. */
const MAX_RETURN_TO = 2048;

/** Where a reviewer lands when there is nowhere to send them back to. */
const HOME = '/';

/**
 * Everything a path may hold, stated as what is allowed rather than as what is
 * not: printable ASCII, and every code point above the C1 block, so a file whose
 * name is written in another script still comes back. What that leaves out is a
 * space, a DEL, and the two control blocks — and a newline among them is the one
 * that could split the `Location` header this value is written into.
 */
const SAFE_PATH = /^[\u0021-\u007e\u00a0-\u{10ffff}]+$/u;

/** One cookie's value out of a `Cookie` header, or nothing. */
export function readCookie(
  header: string | null | undefined,
  name: string
): string | undefined {
  if (header == null) return undefined;
  for (const pair of header.split(';')) {
    const split = pair.indexOf('=');
    if (split < 0) continue;
    if (pair.slice(0, split).trim() !== name) continue;
    const value = pair.slice(split + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

/**
 * One `Set-Cookie` line. `Secure` and `Path=/` are not options: the `__Host-`
 * prefix on both names above requires them, and a caller free to leave them off
 * would be a caller free to write a cookie the browser then drops in silence.
 * `SameSite=Lax` is what keeps a cross-site POST from carrying the session, and
 * `originAllowed` below is the second half of that.
 */
export function setCookieHeader(
  name: string,
  value: string,
  maxAgeSeconds: number
): string {
  return [
    `${name}=${value}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');
}

/** The line that takes a cookie away. */
export function clearCookieHeader(name: string): string {
  return setCookieHeader(name, '', 0);
}

/**
 * Whether `accessToken` may still be sent to GitHub. No skew: the skew is a
 * question about when to refresh, and a token that has not expired is a token
 * that works. Answering with the skew here would drop a reviewer to anonymous
 * for the five minutes before their own refresh landed.
 */
export function accessTokenUsable(
  payload: SessionPayload,
  now: number
): boolean {
  if (payload.accessExpiresAt == null) return true;
  return payload.accessExpiresAt > now;
}

/**
 * Whether `accessToken` is far enough from its expiry to leave alone. This is
 * the one the refresh route asks, and the skew is here: GitHub's clock and this
 * Worker's are not the same clock, and a token that died between the check and
 * the request would cost the reviewer a failed diff where a refresh a few
 * minutes early costs them nothing.
 */
export function accessTokenFresh(
  payload: SessionPayload,
  now: number
): boolean {
  if (payload.accessExpiresAt == null) return true;
  return payload.accessExpiresAt - REFRESH_SKEW_MS > now;
}

/** Whether a refresh is still a thing this session can ask for. */
export function refreshable(payload: SessionPayload, now: number): boolean {
  if (payload.refreshToken == null) return false;
  if (payload.refreshExpiresAt == null) return true;
  return payload.refreshExpiresAt > now;
}

/** Whether the session began recently enough to still be honoured. */
export function withinMaxAge(payload: SessionPayload, now: number): boolean {
  return payload.issuedAt + SESSION_MAX_AGE_MS > now;
}

/**
 * Whether this session can still authenticate anything. A live access token is
 * one way; a spent one with a refresh token behind it is the other.
 */
export function sessionLive(payload: SessionPayload, now: number): boolean {
  if (!withinMaxAge(payload, now)) return false;
  return accessTokenUsable(payload, now) || refreshable(payload, now);
}

/**
 * Whether a request carrying this session has to answer 401 rather than go on
 * without a token.
 *
 * It is the one state where the two are different answers. A spent access token
 * with a live refresh token behind it is a session `/api/auth/refresh` can mend,
 * and a 401 is the only thing that sends the browser there: `withRefresh` asks
 * for the refresh and sends the request again, and nothing else does. A request
 * that went on anonymously instead would answer with something true and wrong —
 * no viewer, Not Found for a private diff — and the reviewer would be told to
 * sign in eight hours after they did, on a cookie good for thirty days.
 *
 * Every other reading gets no 401. A live token is used. A session past the
 * ceiling, or with no refresh token left, is nobody signed in: there is nothing
 * a refresh could fetch, so the browser is not sent to fetch it.
 */
export function refreshDue(payload: SessionPayload, now: number): boolean {
  if (!withinMaxAge(payload, now)) return false;
  if (accessTokenUsable(payload, now)) return false;
  return refreshable(payload, now);
}

/** What is left of the ceiling, in seconds, for the cookie's own `Max-Age`. */
export function sessionCookieMaxAge(
  payload: SessionPayload,
  now: number
): number {
  const remaining = payload.issuedAt + SESSION_MAX_AGE_MS - now;
  return Math.max(0, Math.floor(remaining / 1000));
}

/**
 * The path a sign-in returns to. It arrives from the browser, so every reading
 * of it that is not a path on this site resolves to the home page.
 *
 * Three things are turned away, and the order matters. A value carrying a
 * newline or a control character could split the `Location` header, so nothing
 * else is asked about it. A value opening `//` or `/\` is a protocol-relative
 * address, which is off this site however much it looks like a path. And what
 * survives both is still resolved against a host that does not exist and read
 * back, so `/a/../../b` normalizes and anything that turns out to name another
 * origin is caught by the comparison rather than by a pattern that guessed at
 * every spelling of one.
 */
export function safeReturnTo(raw: string | null | undefined): string {
  if (raw == null || raw.length === 0 || raw.length > MAX_RETURN_TO)
    return HOME;
  if (!SAFE_PATH.test(raw)) return HOME;
  if (!raw.startsWith('/')) return HOME;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return HOME;

  try {
    const base = 'https://ghdiff.invalid';
    const url = new URL(raw, base);
    if (url.origin !== base) return HOME;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return HOME;
  }
}

/**
 * Whether a request that changes something came from this site. `SameSite=Lax`
 * already keeps the session cookie off a cross-site POST in every browser that
 * honours it; this is the check that does not depend on the browser. A request
 * with no `Origin` at all is turned away too, because every fetch this app makes
 * sends one.
 */
export function originAllowed(
  origin: string | null | undefined,
  requestUrl: string
): boolean {
  if (origin == null) return false;
  try {
    return origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}
