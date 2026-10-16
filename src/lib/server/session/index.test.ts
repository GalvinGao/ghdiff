import { cookieValue } from '@test/cookies';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { codeChallenge, randomToken, readKeyring, SessionSeal } from './';
import { parseDeploymentConfig } from '@/lib/server/config';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  type SessionPayload,
} from '@/lib/session';

// The fixtures sign in "now": jose enforces `exp` against the real clock, so
// a frozen timestamp would one day expire, and second-rounded because `iat`
// travels in whole seconds and the round-trip must reproduce `issuedAt`
// exactly.
const NOW = Math.round(Date.now() / 1000) * 1000;
const HOUR = 60 * 60 * 1000;

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

describe('readKeyring', () => {
  it('answers the keys the deployment was given, newest first', () => {
    const config = parseDeploymentConfig({
      SESSION_SECRET: `${KEY}, ${OTHER}`,
    });
    assert.deepEqual(readKeyring(config), [KEY, OTHER]);
  });

  it('answers with nothing for a deployment that set no secret', () => {
    // Not an error. A ghdiff with no App and no secret serves every public
    // diff; what it cannot do is sign anybody in.
    assert.equal(readKeyring(parseDeploymentConfig({})), undefined);
    assert.equal(
      readKeyring(parseDeploymentConfig({ SESSION_SECRET: '  ' })),
      undefined
    );
  });

  it('throws on a value that is not enough base64url bytes', () => {
    assert.throws(
      () =>
        readKeyring(
          parseDeploymentConfig({ SESSION_SECRET: 'not base64url!' })
        ),
      /base64url/
    );
    assert.throws(
      () =>
        readKeyring(
          parseDeploymentConfig({
            SESSION_SECRET: Buffer.from(new Uint8Array(16)).toString(
              'base64url'
            ),
          })
        ),
      /base64url/
    );
    assert.throws(
      () =>
        readKeyring(parseDeploymentConfig({ SESSION_SECRET: `${KEY},short` })),
      /base64url/
    );
  });

  it('throws on a length no base64url encoding produces', () => {
    // 45 characters is one past a full quantum: Node decodes it to 33 bytes
    // without complaint, and only the length says it is a typo.
    assert.throws(
      () =>
        readKeyring(parseDeploymentConfig({ SESSION_SECRET: 'A'.repeat(45) })),
      /base64url/
    );
  });
});

describe('writeSession', () => {
  it('counts Max-Age down from the sign-in, not from the seal', async () => {
    const week = 7 * 24 * HOUR;
    const line = await new SessionSeal([KEY]).writeSession(
      { ...PAYLOAD, issuedAt: NOW - week },
      NOW
    );
    const left = (SESSION_MAX_AGE_MS - week) / 1000;
    assert.ok(line.includes(`Max-Age=${left}`), line);
  });
});

describe('clearSession', () => {
  it('names the session cookie and expires it', () => {
    const line = new SessionSeal([KEY]).clearSession();
    assert.match(line, /^__Host-ghdiff-session=;/);
    assert.ok(line.includes('Max-Age=0'));
  });
});

describe('readSession', () => {
  it('answers nothing when there is no cookie', async () => {
    const request = new Request('https://ghdiff.com/api/diff');
    assert.equal(await new SessionSeal([KEY]).readSession(request), undefined);
  });

  it('answers nothing when the deployment holds no key', async () => {
    const line = await new SessionSeal([KEY]).writeSession(PAYLOAD, NOW);
    const request = requestWith(cookieValue(line));
    assert.equal(
      await new SessionSeal(undefined).readSession(request),
      undefined
    );
  });

  it('answers nothing for a value that is not a cookie of ours at all', async () => {
    for (const junk of ['', 'x', 'not base64url!', 'a.b', 'a.b.c.d']) {
      const request = new Request('https://ghdiff.com/api/diff', {
        headers: { cookie: `${SESSION_COOKIE}=${junk}` },
      });
      assert.equal(
        await new SessionSeal([KEY]).readSession(request),
        undefined,
        junk
      );
    }
  });

  it('keeps the cookie value readable through cookieValue', async () => {
    const seal = new SessionSeal([KEY]);
    const line = await seal.writeSession(PAYLOAD, NOW);
    assert.deepEqual(
      await seal.readSession(requestWith(cookieValue(line))),
      PAYLOAD
    );
  });
});

/** A request that carries the session cookie, the way a browser sends it. */
function requestWith(value: string): Request {
  return new Request('https://ghdiff.com/api/diff', {
    headers: { cookie: `other=1; ${SESSION_COOKIE}=${value}` },
  });
}

describe('randomToken', () => {
  it('is 32 bytes of base64url, and never the same twice', () => {
    const token = randomToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(token, randomToken());
  });
});

describe('codeChallenge', () => {
  it("matches RFC 7636's own worked example", async () => {
    // The verifier and challenge from the PKCE specification, so this test
    // fails if the digest, the encoding, or the character set drifts.
    assert.equal(
      await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    );
  });
});
