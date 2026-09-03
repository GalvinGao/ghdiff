// The cipher half of the session. Nothing else in the app opens a cookie.
//
// The whole session is the cookie. This Worker writes no session row and holds
// nothing about a reviewer between requests, so there is no store for a leak to
// yield: `SESSION_SECRET` on its own opens nothing, because there is nothing
// sealed anywhere for it to open. What is worth guarding is the cookie itself,
// and the guards are here and in `../session.ts` beside it.
//
// The seal is AES-256-GCM under a key HKDF derives per cookie. The salt is
// sixteen fresh bytes on every seal and it travels in the cookie, so one key
// never seals two cookies and GCM's nonce-reuse cliff is not reachable even in
// principle. `SESSION_SECRET` is a list rather than a value, so a rotation costs
// nobody their session.
//
// It takes the keyring as an argument and imports nothing from
// `cloudflare:workers`, which is what lets `node --test` reach it. The caller
// reads the secret out of the environment.

import { fromBase64Url, toBase64Url } from '../base64url.ts';
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
} from '../session.ts';

/**
 * The first byte of every sealed value. It is not a version of the cipher — a
 * new cipher would be a new key anyway — but of the JSON shape underneath, so a
 * payload written by an older build is refused rather than misread.
 */
const VERSION = 1;

const SALT_BYTES = 16;
/** 96 bits, which is the length AES-GCM is defined for. */
const IV_BYTES = 12;

/** The shortest secret worth deriving a 256-bit key from. */
const MIN_SECRET_BYTES = 32;

const TEXT = new TextEncoder();
const INFO = TEXT.encode('ghdiff-session-v1');

/**
 * The keys `SESSION_SECRET` names, newest first: a comma-separated list of
 * base64url values. The first seals every new cookie and every one of them is
 * tried on the way in, which is what makes a rotation invisible to a reviewer.
 * AES-GCM authenticates what it opens, so a wrong key simply fails and no key id
 * has to travel in the cookie.
 *
 * An unset secret answers with nothing, which is a deployment that cannot sign
 * anybody in and still serves every public diff. A secret that is set and is not
 * a key throws, because that is a deployment that meant to have sessions and has
 * a typo instead — and the loud failure is what tells somebody so, where a
 * silent drop would sign every reviewer out and say nothing about why.
 */
export function parseKeyring(
  raw: string | undefined
): readonly string[] | undefined {
  const parts = (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return undefined;
  for (const part of parts) {
    const bytes = fromBase64Url(part);
    if (bytes == null || bytes.length < MIN_SECRET_BYTES) {
      throw new Error(
        `SESSION_SECRET holds a value that is not ${MIN_SECRET_BYTES} or more base64url bytes.`
      );
    }
  }
  return parts;
}

/** The keyring this deployment was given, if it was given one. */
export function readKeyring(): readonly string[] | undefined {
  return parseKeyring(process.env.SESSION_SECRET);
}
/**
 * One imported HKDF key per secret, for the life of the isolate. Importing is
 * cheap and deriving is cheaper, but neither is free, and every request on this
 * Worker opens a cookie.
 */
const imported = new Map<string, Promise<CryptoKey>>();

function hkdfKey(secret: string): Promise<CryptoKey> {
  const cached = imported.get(secret);
  if (cached != null) return cached;
  const bytes = fromBase64Url(secret);
  if (bytes == null) {
    return Promise.reject(new Error('That session secret is not base64url.'));
  }
  const key = crypto.subtle.importKey('raw', bytes, 'HKDF', false, [
    'deriveKey',
  ]);
  imported.set(secret, key);
  return key;
}

function aesKey(
  secret: string,
  salt: Uint8Array<ArrayBuffer>
): Promise<CryptoKey> {
  return hkdfKey(secret).then((base) =>
    crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: INFO },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  );
}

/** The cookie value for a payload: `version‖salt‖iv‖ciphertext‖tag`. */
export async function seal(
  payload: unknown,
  keyring: readonly string[]
): Promise<string> {
  const secret = keyring[0];
  if (secret == null) throw new Error('That keyring holds no key.');

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await aesKey(secret, salt);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      TEXT.encode(JSON.stringify(payload))
    )
  );

  const value = new Uint8Array(1 + salt.length + iv.length + sealed.length);
  value[0] = VERSION;
  value.set(salt, 1);
  value.set(iv, 1 + salt.length);
  value.set(sealed, 1 + salt.length + iv.length);
  return toBase64Url(value);
}

/**
 * The payload a cookie value stands for, or nothing at all. It never throws:
 * every failing reading — a value somebody edited, a key that has been rotated
 * out, a shape an older build wrote — is a reviewer who is signed out, and a
 * reviewer who is signed out is an ordinary state of this app rather than an
 * error in it.
 *
 * `accept` is what turns an authentic payload into a typed one. The seal proves
 * this app wrote the bytes; it proves nothing about which build wrote them.
 */
export async function open<T>(
  value: string,
  keyring: readonly string[],
  accept: (raw: unknown) => T | undefined
): Promise<T | undefined> {
  const bytes = fromBase64Url(value);
  const least = 1 + SALT_BYTES + IV_BYTES;
  if (bytes == null || bytes.length <= least || bytes[0] !== VERSION) {
    return undefined;
  }
  const salt = bytes.subarray(1, 1 + SALT_BYTES);
  const iv = bytes.subarray(1 + SALT_BYTES, least);
  const sealed = bytes.subarray(least);

  for (const secret of keyring) {
    try {
      const key = await aesKey(secret, salt);
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        sealed
      );
      return accept(JSON.parse(new TextDecoder().decode(plain)) as unknown);
    } catch {
      // A wrong key and a tampered cookie fail the same way. Try the next key,
      // and answer with nothing once every key has failed.
    }
  }
  return undefined;
}

// --- The two cookies -------------------------------------------------------

/** The reviewer's session, if this request carries a live one. */
export function readSession(
  request: Request,
  keyring: readonly string[]
): Promise<SessionPayload | undefined> {
  const value = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
  if (value == null) return Promise.resolve(undefined);
  return open(value, keyring, asSessionPayload);
}

/**
 * The `Set-Cookie` line for a session. `Max-Age` counts down from `issuedAt`
 * rather than from now, so a refresh does not extend the ceiling.
 */
export async function writeSession(
  payload: SessionPayload,
  keyring: readonly string[],
  now: number
): Promise<string> {
  return setCookieHeader(
    SESSION_COOKIE,
    await seal(payload, keyring),
    sessionCookieMaxAge(payload, now)
  );
}

/** The `Set-Cookie` line that ends a session. */
export function clearSession(): string {
  return clearCookieHeader(SESSION_COOKIE);
}

/** What the sign-in put aside before it sent the reviewer to GitHub. */
export function readHandoff(
  request: Request,
  keyring: readonly string[]
): Promise<OAuthHandoff | undefined> {
  const value = readCookie(request.headers.get('cookie'), OAUTH_COOKIE);
  if (value == null) return Promise.resolve(undefined);
  return open(value, keyring, asOAuthHandoff);
}

export async function writeHandoff(
  handoff: OAuthHandoff,
  keyring: readonly string[]
): Promise<string> {
  return setCookieHeader(
    OAUTH_COOKIE,
    await seal(handoff, keyring),
    OAUTH_MAX_AGE_MS / 1000
  );
}

/** The handoff is spent the moment the callback reads it, either way. */
export function clearHandoff(): string {
  return clearCookieHeader(OAUTH_COOKIE);
}

// --- What an authentic payload has to look like ------------------------------

function record(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === 'object' && raw != null
    ? (raw as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function moment(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function asSessionPayload(raw: unknown): SessionPayload | undefined {
  const fields = record(raw);
  if (fields == null) return undefined;
  const accessToken = text(fields.accessToken);
  const issuedAt = moment(fields.issuedAt);
  if (accessToken == null || issuedAt == null) return undefined;
  return {
    accessToken,
    issuedAt,
    accessExpiresAt: moment(fields.accessExpiresAt),
    refreshToken: text(fields.refreshToken),
    refreshExpiresAt: moment(fields.refreshExpiresAt),
  };
}

function asOAuthHandoff(raw: unknown): OAuthHandoff | undefined {
  const fields = record(raw);
  if (fields == null) return undefined;
  const state = text(fields.state);
  const verifier = text(fields.verifier);
  const returnTo = text(fields.returnTo);
  if (state == null || verifier == null || returnTo == null) return undefined;
  return { state, verifier, returnTo };
}

// --- The two secrets the authorization flow makes for itself -----------------

/** How many bytes `state` and the PKCE verifier each carry. */
const TOKEN_BYTES = 32;

/** A fresh unguessable value, for `state` and for the PKCE verifier alike. */
export function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/**
 * What GitHub is shown in place of the verifier. PKCE's S256 method is the
 * base64url of the SHA-256 of the verifier's own ASCII, and `randomToken` above
 * already answers in the character set that rule is written for.
 */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', TEXT.encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}
