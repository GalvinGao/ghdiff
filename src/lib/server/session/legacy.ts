// The session seal as builds before the JWE migration wrote it: `version‖salt‖
// iv‖ciphertext‖tag`, AES-256-GCM under a key HKDF derives per cookie. Read-only
// in the app — nothing seals this way any more, and this cipher's whole reason
// to exist is the cookies already in browsers. One lives at most
// `SESSION_MAX_AGE_MS`, so 180 days after the migration deploys every one
// of them has expired and this file, and the branch that calls it, can go.

import type { GitHubGrant, OAuthHandoff, SessionPayload } from '@/lib/session';

/**
 * The first byte of every sealed value. It is not a version of the cipher — a
 * new cipher would be a new key anyway — but of the JSON shape underneath, so a
 * payload written by an older build is refused rather than misread.
 */
const VERSION = 1;

const SALT_BYTES = 16;
/** 96 bits, which is the length AES-GCM is defined for. */
const IV_BYTES = 12;

const TEXT = new TextEncoder();
const INFO = TEXT.encode('ghdiff-session-v1');

/**
 * One imported HKDF key per secret, for the life of the isolate. Importing is
 * cheap and deriving is cheaper, but neither is free, and every request on this
 * Worker opens a cookie.
 */
const imported = new Map<string, Promise<CryptoKey>>();

function hkdfKey(secret: string): Promise<CryptoKey> {
  const cached = imported.get(secret);
  if (cached != null) return cached;
  const key = crypto.subtle.importKey(
    'raw',
    Buffer.from(secret, 'base64url'),
    'HKDF',
    false,
    ['deriveKey']
  );
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

/**
 * The legacy cipher, generic over the payload type its `accept` parses. It
 * reads the cookies pre-migration builds sealed and writes none — the writer
 * those builds used lives on in `legacy.test.ts`, which needs cookies written
 * the old way to prove this read path still opens them.
 */
export class LegacyCipher<T> {
  private readonly keyring: readonly string[];
  private readonly accept: (raw: unknown) => T | undefined;

  constructor(
    keyring: readonly string[],
    accept: (raw: unknown) => T | undefined
  ) {
    this.keyring = keyring;
    this.accept = accept;
  }

  /**
   * The payload a legacy cookie value stands for, or nothing at all. Every
   * failing reading — a value somebody edited, a key that has been rotated
   * out, a shape an older build wrote — is a reviewer who is signed out, and
   * a reviewer who is signed out is an ordinary state of this app rather
   * than an error in it. An authentic payload `accept` refuses is refused
   * outright: the seal already proved which key is its own.
   */
  async open(value: string): Promise<T | undefined> {
    const bytes = new Uint8Array(Buffer.from(value, 'base64url'));
    const least = 1 + SALT_BYTES + IV_BYTES;
    if (bytes.length <= least || bytes[0] !== VERSION) {
      return undefined;
    }
    const salt = bytes.subarray(1, 1 + SALT_BYTES);
    const iv = bytes.subarray(1 + SALT_BYTES, least);
    const sealed = bytes.subarray(least);

    for (const secret of this.keyring) {
      try {
        const key = await aesKey(secret, salt);
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv },
          key,
          sealed
        );
        return this.accept(JSON.parse(new TextDecoder().decode(plain)));
      } catch {
        // A wrong key and a tampered cookie fail the same way. Try the next
        // key, and answer with nothing once every key has failed.
      }
    }
    return undefined;
  }
}

// --- What an authentic legacy payload has to look like -----------------------

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

export function asSessionPayload(raw: unknown): SessionPayload | undefined {
  const fields = record(raw);
  if (fields == null) return undefined;
  const issuedAt = moment(fields.issuedAt);
  // A session is its credential, and issuedAt is the ceiling's anchor: without
  // both there is nothing here to honour.
  if (issuedAt == null || text(fields.accessToken) == null) return undefined;
  return { issuedAt, github: asGitHubGrant(fields) };
}

/**
 * The GitHub grant out of the top-level fields a pre-migration build wrote.
 * Temporary: the legacy JSON is the old shape, with the GitHub credential at
 * the payload's top level, and the payload keys it by forge the way the JWE
 * claims always have — the two meet here and nowhere else. This mapping leaves
 * with the legacy cipher, 180 days after the deploy, when the last of these
 * cookies has expired.
 */
function asGitHubGrant(
  fields: Record<string, unknown>
): GitHubGrant | undefined {
  const accessToken = text(fields.accessToken);
  if (accessToken == null) return undefined;
  return {
    accessToken,
    accessExpiresAt: moment(fields.accessExpiresAt),
    refreshToken: text(fields.refreshToken),
    refreshExpiresAt: moment(fields.refreshExpiresAt),
  };
}

export function asOAuthHandoff(raw: unknown): OAuthHandoff | undefined {
  const fields = record(raw);
  if (fields == null) return undefined;
  const state = text(fields.state);
  const verifier = text(fields.verifier);
  const returnTo = text(fields.returnTo);
  if (state == null || verifier == null || returnTo == null) return undefined;
  return { state, verifier, returnTo };
}
