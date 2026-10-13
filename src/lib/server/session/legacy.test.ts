import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { randomToken, SessionSeal } from './';
import {
  OAUTH_COOKIE,
  type OAuthHandoff,
  SESSION_COOKIE,
  type SessionPayload,
} from '@/lib/session';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

function secret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    'base64url'
  );
}

const KEY = secret();
const OTHER = secret();

/**
 * What a pre-migration build sealed: the GitHub grant as top-level fields,
 * before the payload keyed its credentials by forge. This JSON is the legacy
 * format and stays it — the reader's job is to open it into today's shape.
 */
const LEGACY_JSON = {
  accessToken: 'ghu_example-access-token',
  accessExpiresAt: NOW + 8 * HOUR,
  refreshToken: 'ghr_example-refresh-token',
  refreshExpiresAt: NOW + 180 * 24 * HOUR,
  issuedAt: NOW,
};

/** The same session as the payload the app knows today. */
const PAYLOAD: SessionPayload = {
  issuedAt: NOW,
  github: {
    accessToken: 'ghu_example-access-token',
    accessExpiresAt: NOW + 8 * HOUR,
    refreshToken: 'ghr_example-refresh-token',
    refreshExpiresAt: NOW + 180 * 24 * HOUR,
  },
};

const HANDOFF: OAuthHandoff = {
  state: randomToken(),
  verifier: randomToken(),
  returnTo: '/owner/repo/pull/1#diff-a.ts:R1',
};

const TEXT = new TextEncoder();
const INFO = TEXT.encode('ghdiff-session-v1');

/**
 * A cookie sealed the way a pre-migration build wrote it:
 * `version‖salt‖iv‖ciphertext‖tag`, AES-256-GCM under a per-cookie HKDF key,
 * the keyring's first key sealing. The app reads this format and writes none,
 * so the writer lives here — an independent copy is what proves the read path
 * still opens what a pre-migration build sealed.
 */
async function sealLegacy(
  value: unknown,
  keyring: readonly string[]
): Promise<string> {
  const first = keyring[0];
  if (first == null) throw new Error('That keyring holds no key.');

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey(
    'raw',
    Buffer.from(first, 'base64url'),
    'HKDF',
    false,
    ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: INFO },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      TEXT.encode(JSON.stringify(value))
    )
  );

  const out = new Uint8Array(1 + salt.length + iv.length + sealed.length);
  out[0] = 1;
  out.set(salt, 1);
  out.set(iv, 1 + salt.length);
  out.set(sealed, 1 + salt.length + iv.length);
  return Buffer.from(out).toString('base64url');
}

/** A request that carries one cookie, the way a browser sends it. */
function requestWith(name: string, value: string): Request {
  return new Request('https://ghdiff.com/api/diff', {
    headers: { cookie: `other=1; ${name}=${value}` },
  });
}

describe('the legacy seal, read-only since the JWE migration', () => {
  it('still opens a session a pre-migration build sealed', async () => {
    const value = await sealLegacy(LEGACY_JSON, [KEY]);
    assert.equal(value.split('.').length, 1, value);
    const request = requestWith(SESSION_COOKIE, value);
    assert.deepEqual(await new SessionSeal([KEY]).readSession(request), {
      ...PAYLOAD,
      gitlab: undefined,
    });
  });

  it('maps the old top-level GitHub fields into the keyed grant', async () => {
    // The legacy JSON carries the GitHub credential at the payload's top
    // level; what comes out is the forge-keyed shape, the same session
    // either way.
    const value = await sealLegacy(LEGACY_JSON, [KEY]);
    const request = requestWith(SESSION_COOKIE, value);
    const session = await new SessionSeal([KEY]).readSession(request);
    assert.equal(session?.github?.accessToken, 'ghu_example-access-token');
    assert.equal(session?.github?.accessExpiresAt, NOW + 8 * HOUR);
    assert.equal(session?.github?.refreshToken, 'ghr_example-refresh-token');
    assert.equal(session?.github?.refreshExpiresAt, NOW + 180 * 24 * HOUR);
  });

  it('still opens an older cookie after a rotation', async () => {
    const value = await sealLegacy(LEGACY_JSON, [OTHER]);
    const request = requestWith(SESSION_COOKIE, value);
    assert.deepEqual(await new SessionSeal([KEY, OTHER]).readSession(request), {
      ...PAYLOAD,
      gitlab: undefined,
    });
  });

  it('answers nothing for a value one byte of which moved', async () => {
    const value = await sealLegacy(LEGACY_JSON, [KEY]);
    // Changed in the middle, never at the end. The final base64url character
    // of a value whose length is not a multiple of four carries padding bits
    // that the decoder ignores, so a flip landing in those can decode to the
    // very same bytes and the seal opens — correctly.
    const at = Math.floor(value.length / 2);
    const flipped =
      value.slice(0, at) +
      (value[at] === 'A' ? 'B' : 'A') +
      value.slice(at + 1);
    const request = requestWith(SESSION_COOKIE, flipped);
    assert.equal(await new SessionSeal([KEY]).readSession(request), undefined);
  });

  it('answers nothing for a key that did not seal it', async () => {
    const value = await sealLegacy(LEGACY_JSON, [KEY]);
    const request = requestWith(SESSION_COOKIE, value);
    assert.equal(
      await new SessionSeal([OTHER]).readSession(request),
      undefined
    );
  });

  it('refuses a payload with no access token in it', async () => {
    // The seal proves this app wrote the bytes. It proves nothing about which
    // build wrote them, so the shape is still checked.
    const value = await sealLegacy({ issuedAt: NOW }, [KEY]);
    const request = requestWith(SESSION_COOKIE, value);
    assert.equal(await new SessionSeal([KEY]).readSession(request), undefined);
  });

  it('drops a field that is there but is not what it should be', async () => {
    const value = await sealLegacy(
      {
        ...LEGACY_JSON,
        refreshToken: 42,
        accessExpiresAt: 'soon',
      },
      [KEY]
    );
    const request = requestWith(SESSION_COOKIE, value);
    const read = await new SessionSeal([KEY]).readSession(request);
    assert.equal(read?.github?.accessToken, 'ghu_example-access-token');
    assert.equal(read?.github?.refreshToken, undefined);
    assert.equal(read?.github?.accessExpiresAt, undefined);
  });

  it('keeps GitLab grants through the seal and the open', async () => {
    const legacy = {
      ...LEGACY_JSON,
      gitlab: {
        'gitlab.corp.com': { type: 'pat', token: 'glpat-abc' },
        'gitlab.com': {
          type: 'oauth',
          accessToken: 'tok',
          accessExpiresAt: NOW + 60_000,
          refreshToken: 'ref',
          refreshExpiresAt: undefined,
        },
      },
    };
    const value = await sealLegacy(legacy, [KEY]);
    const request = requestWith(SESSION_COOKIE, value);
    assert.deepEqual(await new SessionSeal([KEY]).readSession(request), {
      ...PAYLOAD,
      gitlab: legacy.gitlab,
    });
  });

  it('drops a malformed grant and keeps the good one', async () => {
    const legacy = {
      ...LEGACY_JSON,
      gitlab: {
        'gitlab.corp.com': { type: 'pat', token: 'glpat-abc' },
        'bad.example.com': { type: 'pat' },
        'worse.example.com': 'a string, not a grant',
      },
    };
    const value = await sealLegacy(legacy, [KEY]);
    const request = requestWith(SESSION_COOKIE, value);
    const session = await new SessionSeal([KEY]).readSession(request);
    assert.deepEqual(session?.gitlab, {
      'gitlab.corp.com': { type: 'pat', token: 'glpat-abc' },
    });
  });

  it('refuses a session with no credential in it at all', async () => {
    const value = await sealLegacy({ issuedAt: NOW, gitlab: {} }, [KEY]);
    const request = requestWith(SESSION_COOKIE, value);
    assert.equal(await new SessionSeal([KEY]).readSession(request), undefined);
  });

  it('still opens a handoff a pre-migration build sealed', async () => {
    const value = await sealLegacy(HANDOFF, [KEY]);
    const request = requestWith(OAUTH_COOKIE, value);
    assert.deepEqual(await new SessionSeal([KEY]).readHandoff(request), {
      ...HANDOFF,
      forge: undefined,
      host: undefined,
    });
  });

  it('refuses a handoff missing any of its three parts', async () => {
    for (const missing of ['state', 'verifier', 'returnTo'] as const) {
      const partial = { ...HANDOFF, [missing]: undefined } as OAuthHandoff;
      const request = requestWith(
        OAUTH_COOKIE,
        await sealLegacy(partial, [KEY])
      );
      assert.equal(
        await new SessionSeal([KEY]).readHandoff(request),
        undefined,
        missing
      );
    }
  });

  it('keeps a GitLab forge and host, and reads an old handoff as GitHub', async () => {
    const gitlab = {
      ...HANDOFF,
      forge: 'gitlab' as const,
      host: 'gitlab.corp.com',
    };
    const request = requestWith(OAUTH_COOKIE, await sealLegacy(gitlab, [KEY]));
    assert.deepEqual(await new SessionSeal([KEY]).readHandoff(request), gitlab);
  });
});
