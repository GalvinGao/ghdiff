// The cipher half of the session. Nothing else in the app opens a cookie.
//
// The whole session is the cookie. This Worker writes no session row and holds
// nothing about a reviewer between requests, so there is no store for a leak to
// yield: `SESSION_SECRET` on its own opens nothing, because there is nothing
// sealed anywhere for it to open. What is worth guarding is the cookie itself,
// and the guards are here and in `@/lib/session` beside it.
//
// Every new cookie is a JWE — `dir` key management, A256GCM content encryption
// — and cookies sealed by builds before the migration are read by the legacy
// cipher beside it, which writes none and can go 180 days after the deploy,
// when the last of them has expired. A value goes to the cipher that owns its
// shape — five base64url segments is the JWE's, and nothing else this app has
// ever sealed is — so neither is ever asked to read the other's.
//
// `SESSION_SECRET` is a list rather than a value, so a rotation costs nobody
// their session.

import { JweCipher } from './jwe';
import { asOAuthHandoff, asSessionPayload, LegacyCipher } from './legacy';
import {
  handoffClaimsSchema,
  handoffFromClaims,
  handoffToClaims,
  sessionClaimsSchema,
  sessionFromClaims,
  sessionToClaims,
} from './payload';
import type { DeploymentConfig } from '@/lib/server/config';
import {
  clearCookieHeader,
  OAUTH_COOKIE,
  OAUTH_MAX_AGE_MS,
  type OAuthHandoff,
  readCookie,
  SESSION_COOKIE,
  type SessionPayload,
  sessionCookieMaxAge,
  setCookieHeader,
} from '@/lib/session';

/** The shortest secret worth deriving a 256-bit key from. */
const MIN_SECRET_BYTES = 32;

/** The alphabet a base64url secret is written in, and nothing else. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

const TEXT = new TextEncoder();

/**
 * The keyring this deployment was given, if it was given one. The first key
 * seals every new cookie and every one of them can be tried on the way in,
 * which is what makes a rotation invisible to a reviewer. An authenticated
 * seal proves what it opens, so a wrong key simply fails.
 *
 * An empty keyring answers with nothing, which is a deployment that cannot
 * sign anybody in and still serves every public diff. A key that is not one
 * throws, because that is a deployment that meant to have sessions and has a
 * typo instead — and the loud failure is what tells somebody so, where a
 * silent drop would sign every reviewer out and say nothing about why.
 */
export function readKeyring(
  config: DeploymentConfig
): readonly string[] | undefined {
  const keyring = config.sessionKeyring;
  if (keyring.length === 0) return undefined;
  for (const key of keyring) {
    // Node decodes base64url leniently, so a length no encoding can produce
    // — one character past a full quantum — is refused here, not trimmed.
    if (
      !BASE64URL.test(key) ||
      key.length % 4 === 1 ||
      Buffer.from(key, 'base64url').length < MIN_SECRET_BYTES
    ) {
      throw new Error(
        `SESSION_SECRET holds a value that is not ${MIN_SECRET_BYTES} or more base64url bytes.`
      );
    }
  }
  return keyring;
}

/**
 * The session's two cookies behind one seal. It is built with the keyring the
 * deployment's config answered — or with nothing, which is a deployment that
 * cannot sign anybody in: every read answers with nothing then, the way it
 * does for a request that carries no cookie, and every write refuses.
 */
export class SessionSeal {
  private readonly keyring: readonly string[] | undefined;

  constructor(keyring: readonly string[] | undefined) {
    this.keyring = keyring;
  }

  /** The reviewer's session, if this request carries a live one. */
  async readSession(request: Request): Promise<SessionPayload | undefined> {
    const value = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
    if (value == null || this.keyring == null) return undefined;
    const jwe = new JweCipher(this.keyring, sessionClaimsSchema);
    if (jwe.owns(value)) {
      const claims = await jwe.open(value);
      return claims == null ? undefined : sessionFromClaims(claims);
    }
    return new LegacyCipher(this.keyring, asSessionPayload).open(value);
  }

  /**
   * The `Set-Cookie` line for a session. The claims' `iat` is the sign-in and
   * `exp` the end of the ceiling above it, so a refresh re-seals the same
   * window rather than rolling it forward — and the cookie's own `Max-Age`
   * counts down from the sign-in for the same reason.
   */
  async writeSession(payload: SessionPayload, now: number): Promise<string> {
    const value = await new JweCipher(
      this.mustKeyring(),
      sessionClaimsSchema
    ).seal(sessionToClaims(payload));
    return setCookieHeader(
      SESSION_COOKIE,
      value,
      sessionCookieMaxAge(payload, now)
    );
  }

  /** The `Set-Cookie` line that ends a session. */
  clearSession(): string {
    return clearCookieHeader(SESSION_COOKIE);
  }

  /** What the sign-in put aside before it sent the reviewer to the forge. */
  async readHandoff(request: Request): Promise<OAuthHandoff | undefined> {
    const value = readCookie(request.headers.get('cookie'), OAUTH_COOKIE);
    if (value == null || this.keyring == null) return undefined;
    const jwe = new JweCipher(this.keyring, handoffClaimsSchema);
    if (jwe.owns(value)) {
      const claims = await jwe.open(value);
      return claims == null ? undefined : handoffFromClaims(claims);
    }
    return new LegacyCipher(this.keyring, asOAuthHandoff).open(value);
  }

  async writeHandoff(handoff: OAuthHandoff): Promise<string> {
    const value = await new JweCipher(
      this.mustKeyring(),
      handoffClaimsSchema
    ).seal(handoffToClaims(handoff, Date.now()));
    return setCookieHeader(OAUTH_COOKIE, value, OAUTH_MAX_AGE_MS / 1000);
  }

  /** The handoff is spent the moment the callback reads it, either way. */
  clearHandoff(): string {
    return clearCookieHeader(OAUTH_COOKIE);
  }

  private mustKeyring(): readonly string[] {
    if (this.keyring == null) throw new Error('That keyring holds no key.');
    return this.keyring;
  }
}

// --- The two secrets the authorization flow makes for itself -----------------

/** How many bytes `state` and the PKCE verifier each carry. */
const TOKEN_BYTES = 32;

/** A fresh unguessable value, for `state` and for the PKCE verifier alike. */
export function randomToken(): string {
  return Buffer.from(
    crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))
  ).toString('base64url');
}

/**
 * What the forge is shown in place of the verifier. PKCE's S256 method is the
 * base64url of the SHA-256 of the verifier's own ASCII, and `randomToken` above
 * already answers in the character set that rule is written for.
 */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', TEXT.encode(verifier));
  return Buffer.from(digest).toString('base64url');
}
