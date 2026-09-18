import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  accessTokenFresh,
  accessTokenUsable,
  clearCookieHeader,
  originAllowed,
  readCookie,
  refreshable,
  refreshDue,
  REFRESH_SKEW_MS,
  safeReturnTo,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  type SessionPayload,
  sessionCookieMaxAge,
  sessionLive,
  setCookieHeader,
  withinMaxAge,
} from './session.ts';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

function session(overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    accessToken: 'ghu_test',
    accessExpiresAt: NOW + 8 * HOUR,
    refreshToken: 'ghr_test',
    refreshExpiresAt: NOW + 180 * 24 * HOUR,
    issuedAt: NOW,
    ...overrides,
  };
}

describe('readCookie', () => {
  it('finds one value among several', () => {
    const header = `a=1; ${SESSION_COOKIE}=sealed; b=2`;
    assert.equal(readCookie(header, SESSION_COOKIE), 'sealed');
  });

  it('does not answer for a name this one is only a prefix of', () => {
    const header = `${SESSION_COOKIE}-old=wrong; ${SESSION_COOKIE}=right`;
    assert.equal(readCookie(header, SESSION_COOKIE), 'right');
  });

  it('keeps a value that carries its own equals sign', () => {
    assert.equal(readCookie('a=one=two', 'a'), 'one=two');
  });

  it('answers nothing for an absent name, an empty value, and no header', () => {
    assert.equal(readCookie('a=1', 'b'), undefined);
    assert.equal(readCookie('a=', 'a'), undefined);
    assert.equal(readCookie(null, 'a'), undefined);
  });
});

describe('setCookieHeader', () => {
  it('states every attribute the __Host- prefix requires, and Lax besides', () => {
    const line = setCookieHeader(SESSION_COOKIE, 'sealed', 60);
    assert.match(line, /^__Host-ghdiff-session=sealed;/);
    for (const attribute of [
      'Path=/',
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
      'Max-Age=60',
    ]) {
      assert.ok(line.includes(attribute), attribute);
    }
    // No Domain, or the browser drops a __Host- cookie without a word.
    assert.ok(!line.includes('Domain'));
  });

  it('writes a whole number of seconds, and never a negative one', () => {
    assert.ok(setCookieHeader('a', 'b', 1.9).includes('Max-Age=1'));
    assert.ok(setCookieHeader('a', 'b', -5).includes('Max-Age=0'));
  });
});

describe('clearCookieHeader', () => {
  it('expires the cookie at once', () => {
    const line = clearCookieHeader(SESSION_COOKIE);
    assert.ok(line.includes('Max-Age=0'));
    assert.match(line, /^__Host-ghdiff-session=;/);
  });
});

describe('accessTokenUsable', () => {
  it('still sends a token that is inside the skew but not expired', () => {
    // The whole reason this is not the same question as accessTokenFresh: a
    // token five minutes from its expiry works, and answering no here would
    // drop a signed-in reviewer to anonymous until their own refresh landed.
    const nearly = session({ accessExpiresAt: NOW + REFRESH_SKEW_MS - 1000 });
    assert.equal(accessTokenUsable(nearly, NOW), true);
    assert.equal(accessTokenFresh(nearly, NOW), false);
  });

  it('stops at the expiry itself', () => {
    assert.equal(
      accessTokenUsable(session({ accessExpiresAt: NOW - 1 }), NOW),
      false
    );
    assert.equal(
      accessTokenUsable(session({ accessExpiresAt: NOW + 1 }), NOW),
      true
    );
  });
});

describe('accessTokenFresh', () => {
  it('counts a token spent while it is still inside the skew', () => {
    const nearly = session({ accessExpiresAt: NOW + REFRESH_SKEW_MS - 1000 });
    assert.equal(accessTokenFresh(nearly, NOW), false);
    assert.equal(accessTokenFresh(session(), NOW), true);
  });
});

describe('a token with no stated expiry', () => {
  it('is both usable and fresh', () => {
    // The App can have user-to-server expiry turned off, and GitHub then states
    // no life at all rather than a life of zero.
    const forever = session({ accessExpiresAt: undefined });
    assert.equal(accessTokenUsable(forever, NOW), true);
    assert.equal(accessTokenFresh(forever, NOW), true);
  });
});

describe('refreshable', () => {
  it('needs a refresh token', () => {
    assert.equal(refreshable(session({ refreshToken: undefined }), NOW), false);
  });

  it('reads an absent expiry as no expiry, and a past one as spent', () => {
    assert.equal(
      refreshable(session({ refreshExpiresAt: undefined }), NOW),
      true
    );
    assert.equal(
      refreshable(session({ refreshExpiresAt: NOW - 1 }), NOW),
      false
    );
  });
});

describe('sessionLive', () => {
  it('holds a spent access token up on its refresh token', () => {
    const spent = session({ accessExpiresAt: NOW - 1 });
    assert.equal(accessTokenUsable(spent, NOW), false);
    assert.equal(sessionLive(spent, NOW), true);
  });

  it('is dead once both are spent', () => {
    const dead = session({
      accessExpiresAt: NOW - 1,
      refreshExpiresAt: NOW - 1,
    });
    assert.equal(sessionLive(dead, NOW), false);
  });

  it('is dead past the ceiling however good the refresh token is', () => {
    // The ceiling is the point of this: GitHub would honour the refresh token
    // for six months, and this app will not.
    const old = session({ issuedAt: NOW - SESSION_MAX_AGE_MS - 1 });
    assert.equal(refreshable(old, NOW), true);
    assert.equal(withinMaxAge(old, NOW), false);
    assert.equal(sessionLive(old, NOW), false);
  });
});

describe('refreshDue', () => {
  it('names a spent access token with a live refresh token behind it', () => {
    // The one state a request answers 401 for: the browser holds a cookie the
    // refresh route can mend, and 401 is the only thing that sends it there.
    const spent = session({ accessExpiresAt: NOW - 1 });
    assert.equal(refreshDue(spent, NOW), true);
  });

  it('is not due while the token still works, skew or no skew', () => {
    // `accessTokenUsable` is the test and not `accessTokenFresh`: a token inside
    // the skew is sent as it is, and the refresh route is asked nothing.
    assert.equal(refreshDue(session(), NOW), false);
    const inside = session({ accessExpiresAt: NOW + REFRESH_SKEW_MS - 1 });
    assert.equal(accessTokenFresh(inside, NOW), false);
    assert.equal(refreshDue(inside, NOW), false);
  });

  it('is not due for a session a refresh could not mend', () => {
    // Nothing to send the browser to fetch, so it goes on as nobody. Both
    // readings agree with `sessionLive`: a session that is dead is not due.
    const noRefresh = session({
      accessExpiresAt: NOW - 1,
      refreshToken: undefined,
    });
    const refreshSpent = session({
      accessExpiresAt: NOW - 1,
      refreshExpiresAt: NOW - 1,
    });
    const old = session({
      accessExpiresAt: NOW - 1,
      issuedAt: NOW - SESSION_MAX_AGE_MS - 1,
    });
    for (const dead of [noRefresh, refreshSpent, old]) {
      assert.equal(sessionLive(dead, NOW), false);
      assert.equal(refreshDue(dead, NOW), false);
    }
  });

  it('is never due for a token that states no expiry', () => {
    const forever = session({
      accessExpiresAt: undefined,
      refreshToken: undefined,
    });
    assert.equal(refreshDue(forever, NOW), false);
  });
});

describe('sessionCookieMaxAge', () => {
  it('counts down from the sign-in and not from now', () => {
    const day = 24 * HOUR;
    const week = session({ issuedAt: NOW - 7 * day });
    assert.equal(
      sessionCookieMaxAge(week, NOW),
      (SESSION_MAX_AGE_MS - 7 * day) / 1000
    );
  });

  it('never asks the browser to keep a spent cookie', () => {
    const old = session({ issuedAt: NOW - SESSION_MAX_AGE_MS - HOUR });
    assert.equal(sessionCookieMaxAge(old, NOW), 0);
  });
});

describe('safeReturnTo', () => {
  it('keeps a path on this site whole, fragment included', () => {
    const path = '/owner/repo/pull/1?a=1#diff-src/lib/session.ts:R42-R58';
    assert.equal(safeReturnTo(path), path);
  });

  it('keeps a file whose name is written in another script', () => {
    // The allowlist permits every code point above the C1 block rather than
    // ASCII alone, so the path survives — and `URL` then percent-encodes it,
    // which is the same thing the browser does to its own address bar. What
    // comes back is what the browser would have sent in the first place.
    assert.equal(
      safeReturnTo('/o/r/pull/1#diff-src/日本語.ts'),
      '/o/r/pull/1#diff-src/%E6%97%A5%E6%9C%AC%E8%AA%9E.ts'
    );
  });

  it('refuses a protocol-relative address, however it is spelled', () => {
    assert.equal(safeReturnTo('//evil.example'), '/');
    assert.equal(safeReturnTo('/\\evil.example'), '/');
    assert.equal(safeReturnTo('https://evil.example/x'), '/');
    assert.equal(safeReturnTo('evil.example'), '/');
  });

  it('refuses anything that could split the Location header', () => {
    assert.equal(safeReturnTo('/a\r\nSet-Cookie: x=1'), '/');
    assert.equal(safeReturnTo('/a\nb'), '/');
    assert.equal(safeReturnTo('/a b'), '/');
  });

  it('normalizes a path that climbs, rather than refusing it', () => {
    assert.equal(safeReturnTo('/a/../b'), '/b');
    assert.equal(safeReturnTo('/a/../../b'), '/b');
  });

  it('falls back to the home page for nothing at all', () => {
    assert.equal(safeReturnTo(null), '/');
    assert.equal(safeReturnTo(undefined), '/');
    assert.equal(safeReturnTo(''), '/');
    assert.equal(safeReturnTo(`/${'x'.repeat(4096)}`), '/');
  });
});

describe('originAllowed', () => {
  it('answers for this site alone', () => {
    const url = 'https://ghdiff.com/api/auth/refresh';
    assert.equal(originAllowed('https://ghdiff.com', url), true);
    assert.equal(originAllowed('https://evil.example', url), false);
    assert.equal(originAllowed('https://app.ghdiff.com', url), false);
    // The scheme says nothing behind a TLS-terminating proxy; the port still
    // does, because cookies ignore it.
    assert.equal(originAllowed('http://ghdiff.com', url), true);
    assert.equal(originAllowed('https://ghdiff.com:8443', url), false);
  });

  it('passes the TLS-terminating proxy shape this check exists for', () => {
    // The pod hears plain http while the page is https: the host is the
    // answer either way.
    assert.equal(
      originAllowed('https://ghdiff.com', 'http://ghdiff.com/api/auth/refresh'),
      true
    );
  });

  it('turns away a request that names no origin', () => {
    // Every fetch this app makes sends one, so an absent header is not this
    // app asking.
    assert.equal(originAllowed(null, 'https://ghdiff.com/x'), false);
    assert.equal(originAllowed(undefined, 'https://ghdiff.com/x'), false);
  });
});
