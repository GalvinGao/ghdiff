// The session seal as a JWE: compact serialization, `dir` key management and
// A256GCM content encryption, which is AES-256-GCM over a 256-bit key the
// deployment's secret derives to. jose generates a fresh 96-bit IV on every
// encryption, which is the property the per-cookie HKDF salt used to buy.
//
// The reader tries every keyring key in order and lets the seal authenticate —
// a rotation reorders the keyring, so a header that named one key when a
// cookie was sealed can name another now. A wrong key costs one failed
// decryption, never a signed-out reviewer.
//
// The cipher is generic over the claims type, and the schema it is built with
// is what makes `open`'s answer that type rather than an assertion: an
// authentic value whose claims fail the schema is refused like any other.

import { EncryptJWT, jwtDecrypt } from 'jose';
import type { JWTPayload } from 'jose';
import type { ZodType } from 'zod';

const TEXT = new TextEncoder();
const INFO = TEXT.encode('ghdiff-session-jwe');

/**
 * One derived content-encryption key per secret, for the life of the isolate.
 * `dir` with A256GCM wants exactly 256 bits and `SESSION_SECRET` is thirty-two
 * base64url bytes or more, so each secret is run through HKDF-SHA256 once —
 * no salt, a fixed info, the same 32 bytes every time.
 */
const derived = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

function contentKey(secret: string): Promise<Uint8Array<ArrayBuffer>> {
  const cached = derived.get(secret);
  if (cached != null) return cached;
  const key = crypto.subtle
    .importKey('raw', Buffer.from(secret, 'base64url'), 'HKDF', false, [
      'deriveBits',
    ])
    .then((base) =>
      crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: INFO },
        base,
        256
      )
    )
    .then((bits) => new Uint8Array(bits));
  derived.set(secret, key);
  return key;
}

/** The JWE cipher: the seal every new cookie gets. */
export class JweCipher<C> {
  private readonly keyring: readonly string[];
  private readonly schema: ZodType<C>;

  constructor(keyring: readonly string[], schema: ZodType<C>) {
    this.keyring = keyring;
    this.schema = schema;
  }

  /**
   * A compact JWE is five base64url segments — for `dir` the second, the
   * encrypted key, is empty — and nothing else this app has ever sealed is.
   */
  owns(value: string): boolean {
    return value.split('.').length === 5;
  }

  /** The cookie value for a set of claims, `iat` and `exp` included. */
  async seal(claims: C): Promise<string> {
    const secret = this.keyring[0];
    if (secret == null) throw new Error('That keyring holds no key.');

    const key = await contentKey(secret);
    return new EncryptJWT(claims as JWTPayload)
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .encrypt(key);
  }

  /**
   * The claims a JWE value carries, or nothing at all. Every failing reading
   * — a value somebody edited, a key that has been rotated out, an `exp`
   * that has passed, claims the schema refuses — is a reviewer who is signed
   * out, and a reviewer who is signed out is an ordinary state of this app
   * rather than an error in it.
   */
  async open(value: string): Promise<C | undefined> {
    for (const secret of this.keyring) {
      try {
        const { payload } = await jwtDecrypt(value, await contentKey(secret));
        const parsed = this.schema.safeParse(payload);
        return parsed.success ? parsed.data : undefined;
      } catch {
        // A wrong key, a tampered cookie and an expired one fail the same way.
        // Try the next key, and answer with nothing once every key has failed.
      }
    }
    return undefined;
  }
}
