import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fromBase64Url, toBase64Url } from '../base64url.ts';
import {
  OAUTH_COOKIE,
  type OAuthHandoff,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  type SessionPayload,
} from '../session.ts';
import {
  clearSession,
  codeChallenge,
  open,
  parseKeyring,
  randomToken,
  readHandoff,
  readSession,
  seal,
  writeHandoff,
  writeSession,
} from './session.ts';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

function secret(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

const KEY = secret();
const OTHER = secret();

const PAYLOAD: SessionPayload = {
  accessToken: 'ghu_16C7e42F292c6912E7710c838347Ae178B4a',
  accessExpiresAt: NOW + 8 * HOUR,
  refreshToken: 'ghr_1B4a2e77838347a7E420ce178F2E7c6912E169',
  refreshExpiresAt: NOW + 180 * 24 * HOUR,
  issuedAt: NOW,
};

const HANDOFF: OAuthHandoff = {
  state: randomToken(),
  verifier: randomToken(),
  returnTo: '/owner/repo/pull/1#diff-a.ts:R1',
};

/** What `open` needs to turn an authentic payload into a typed one. */
const anything = (raw: unknown) => raw as Record<string, unknown>;

/** A request that carries one cookie, the way a browser sends it. */
function requestWith(name: string, value: string): Request {
  return new Request('https://ghdiff.com/api/diff', {
    headers: { cookie: `other=1; ${name}=${value}` },
  });
}

/** The value out of a `Set-Cookie` line. */
function cookieValue(line: string): string {
  return line.slice(line.indexOf('=') + 1, line.indexOf(';'));
}

describe('parseKeyring', () => {
  it('reads a comma-separated list, newest first', () => {
    assert.deepEqual(parseKeyring(`${KEY}, ${OTHER}`), [KEY, OTHER]);
  });

  it('answers with nothing for a deployment that set no secret', () => {
    // Not an error. A ghdiff with no App and no secret serves every public
    // diff; what it cannot do is sign anybody in.
    assert.equal(parseKeyring(undefined), undefined);
    assert.equal(parseKeyring('  '), undefined);
  });

  it('throws on a value that is not enough base64url bytes', () => {
    assert.throws(() => parseKeyring('not base64url!'), /base64url/);
    assert.throws(
      () => parseKeyring(toBase64Url(new Uint8Array(16))),
      /base64url/
    );
    assert.throws(() => parseKeyring(`${KEY},short`), /base64url/);
  });
});

describe('seal and open', () => {
  it('reads back exactly what was sealed', async () => {
    const value = await seal(PAYLOAD, [KEY]);
    assert.deepEqual(await open(value, [KEY], anything), PAYLOAD);
  });

  it('writes a different value every time', async () => {
    // A fresh salt and a fresh iv per seal, so one key never seals two cookies.
    const first = await seal(PAYLOAD, [KEY]);
    const second = await seal(PAYLOAD, [KEY]);
    assert.notEqual(first, second);
  });

  it('answers nothing for a value one byte of which moved', async () => {
    const value = await seal(PAYLOAD, [KEY]);
    // Changed in the middle, never at the end. The final base64url character of
    // a value whose length is not a multiple of four carries padding bits that
    // `atob` ignores, so a flip landing in those decodes to the very same bytes
    // and the seal opens — correctly. A test that changed the last character
    // would pass or fail on where the random salt happened to land.
    const at = Math.floor(value.length / 2);
    const flipped =
      value.slice(0, at) +
      (value[at] === 'A' ? 'B' : 'A') +
      value.slice(at + 1);

    // Proof the change reached the bytes, so this can never test nothing.
    assert.notDeepEqual(fromBase64Url(flipped), fromBase64Url(value));
    assert.equal(await open(flipped, [KEY], anything), undefined);
  });

  it('answers nothing for a key that did not seal it', async () => {
    const value = await seal(PAYLOAD, [KEY]);
    assert.equal(await open(value, [OTHER], anything), undefined);
  });

  it('opens an older cookie after a rotation', async () => {
    // The point of the keyring: the new key seals from now on, and the old one
    // is still tried, so nobody is signed out by a rotation.
    const value = await seal(PAYLOAD, [OTHER]);
    assert.deepEqual(await open(value, [KEY, OTHER], anything), PAYLOAD);
  });

  it('answers nothing for a value that is not one of ours at all', async () => {
    for (const junk of [
      '',
      'x',
      'not base64url!',
      toBase64Url(new Uint8Array(29)),
    ]) {
      assert.equal(await open(junk, [KEY], anything), undefined, junk);
    }
  });
});

describe('readSession', () => {
  it('reads the cookie writeSession wrote', async () => {
    const line = await writeSession(PAYLOAD, [KEY], NOW);
    const request = requestWith(SESSION_COOKIE, cookieValue(line));
    assert.deepEqual(await readSession(request, [KEY]), PAYLOAD);
  });

  it('answers nothing when there is no cookie', async () => {
    const request = new Request('https://ghdiff.com/api/diff');
    assert.equal(await readSession(request, [KEY]), undefined);
  });

  it('refuses a payload with no access token in it', async () => {
    // The seal proves this app wrote the bytes. It proves nothing about which
    // build wrote them, so the shape is still checked.
    const value = await seal({ issuedAt: NOW }, [KEY]);
    const request = requestWith(SESSION_COOKIE, value);
    assert.equal(await readSession(request, [KEY]), undefined);
  });

  it('drops a field that is there but is not what it should be', async () => {
    const value = await seal(
      { ...PAYLOAD, refreshToken: 42, accessExpiresAt: 'soon' },
      [KEY]
    );
    const request = requestWith(SESSION_COOKIE, value);
    const read = await readSession(request, [KEY]);
    assert.equal(read?.accessToken, PAYLOAD.accessToken);
    assert.equal(read?.refreshToken, undefined);
    assert.equal(read?.accessExpiresAt, undefined);
  });
});

describe('writeSession', () => {
  it('counts Max-Age down from the sign-in, not from the seal', async () => {
    const week = 7 * 24 * HOUR;
    const line = await writeSession(
      { ...PAYLOAD, issuedAt: NOW - week },
      [KEY],
      NOW
    );
    const left = (SESSION_MAX_AGE_MS - week) / 1000;
    assert.ok(line.includes(`Max-Age=${left}`), line);
  });
});

describe('clearSession', () => {
  it('names the session cookie and expires it', () => {
    const line = clearSession();
    assert.match(line, /^__Host-ghdiff-session=;/);
    assert.ok(line.includes('Max-Age=0'));
  });
});

describe('readHandoff', () => {
  it('reads the handoff writeHandoff wrote', async () => {
    const line = await writeHandoff(HANDOFF, [KEY]);
    assert.ok(line.includes('Max-Age=600'), line);
    const request = requestWith(OAUTH_COOKIE, cookieValue(line));
    assert.deepEqual(await readHandoff(request, [KEY]), HANDOFF);
  });

  it('refuses a handoff missing any of its three parts', async () => {
    for (const missing of ['state', 'verifier', 'returnTo'] as const) {
      const partial = { ...HANDOFF, [missing]: undefined };
      const request = requestWith(OAUTH_COOKIE, await seal(partial, [KEY]));
      assert.equal(await readHandoff(request, [KEY]), undefined, missing);
    }
  });
});

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
