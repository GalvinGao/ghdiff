import { cookieValue } from '@test/cookies';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { randomToken, SessionSeal } from './';
import { SESSION_MAX_AGE_MS } from '@/lib/session';
import {
  OAUTH_COOKIE,
  type OAuthHandoff,
  SESSION_COOKIE,
  type SessionPayload,
} from '@/lib/session';

// The fixtures sign in "now": jose enforces `exp` against the real clock, so
// a frozen timestamp would one day expire, and second-rounded because `iat`
// travels in whole seconds and the round-trip must reproduce `issuedAt`
// exactly.
const NOW = Math.round(Date.now() / 1000) * 1000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function secret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    'base64url'
  );
}

const KEY = secret();
const OTHER = secret();

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

/** A request that carries one cookie, the way a browser sends it. */
function requestWith(name: string, value: string): Request {
  return new Request('https://ghdiff.com/api/diff', {
    headers: { cookie: `other=1; ${name}=${value}` },
  });
}

describe('the JWE seal', () => {
  it('writes a compact JWE: five base64url segments', async () => {
    const line = await new SessionSeal([KEY]).writeSession(PAYLOAD, NOW);
    const value = cookieValue(line);
    // Five, and the second — the encrypted key — is empty under `dir`.
    assert.equal(value.split('.').length, 5, value);
    for (const segment of value.split('.')) {
      assert.match(segment, /^[A-Za-z0-9_-]*$/, value);
    }
  });

  it('reads back exactly what was sealed', async () => {
    const seal = new SessionSeal([KEY]);
    const line = await seal.writeSession(PAYLOAD, NOW);
    const request = requestWith(SESSION_COOKIE, cookieValue(line));
    assert.deepEqual(await seal.readSession(request), PAYLOAD);
  });

  it('writes a different value every time', async () => {
    // A fresh iv per seal, so one key never seals two cookies alike.
    const seal = new SessionSeal([KEY]);
    const first = cookieValue(await seal.writeSession(PAYLOAD, NOW));
    const second = cookieValue(await seal.writeSession(PAYLOAD, NOW));
    assert.notEqual(first, second);
  });

  it('answers nothing for a value one character of which moved', async () => {
    const seal = new SessionSeal([KEY]);
    const value = cookieValue(await seal.writeSession(PAYLOAD, NOW));
    // Changed in the middle, never at the end. The final base64url character
    // of a segment whose length is not a multiple of four carries padding
    // bits that the decoder ignores, so a flip landing there can decode to
    // the very same bytes.
    const at = Math.floor(value.length / 2);
    const flipped =
      value.slice(0, at) +
      (value[at] === 'A' ? 'B' : 'A') +
      value.slice(at + 1);
    const request = requestWith(SESSION_COOKIE, flipped);
    assert.equal(await seal.readSession(request), undefined);
  });

  it('answers nothing for a key that did not seal it', async () => {
    const line = await new SessionSeal([KEY]).writeSession(PAYLOAD, NOW);
    const request = requestWith(SESSION_COOKIE, cookieValue(line));
    assert.equal(
      await new SessionSeal([OTHER]).readSession(request),
      undefined
    );
  });

  it('opens an older cookie after a rotation', async () => {
    // Sealed under OTHER, read with KEY first: one failed decryption before
    // the key that sealed is reached, and trying the keyring in order is what
    // keeps the rotation invisible.
    const line = await new SessionSeal([OTHER]).writeSession(PAYLOAD, NOW);
    const request = requestWith(SESSION_COOKIE, cookieValue(line));
    assert.deepEqual(
      await new SessionSeal([KEY, OTHER]).readSession(request),
      PAYLOAD
    );
  });

  it('refuses a session whose ceiling has passed', async () => {
    // `exp` is the end of the session window above the sign-in, and jose
    // enforces it against the real clock — so this one is signed in a session
    // window and a day before now, not before the test's own NOW.
    const seal = new SessionSeal([KEY]);
    const issuedAt = Date.now() - SESSION_MAX_AGE_MS - DAY;
    const line = await seal.writeSession({ ...PAYLOAD, issuedAt }, Date.now());
    const request = requestWith(SESSION_COOKIE, cookieValue(line));
    assert.equal(await seal.readSession(request), undefined);
  });

  it('refuses a session with no credential in it at all', async () => {
    const seal = new SessionSeal([KEY]);
    const line = await seal.writeSession({ issuedAt: NOW }, NOW);
    const request = requestWith(SESSION_COOKIE, cookieValue(line));
    assert.equal(await seal.readSession(request), undefined);
  });
});

describe('the JWE handoff', () => {
  it('reads the handoff writeHandoff wrote', async () => {
    const seal = new SessionSeal([KEY]);
    const line = await seal.writeHandoff(HANDOFF);
    assert.ok(line.includes('Max-Age=600'), line);
    const request = requestWith(OAUTH_COOKIE, cookieValue(line));
    assert.deepEqual(await seal.readHandoff(request), HANDOFF);
  });
});
