import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { parseDeploymentConfig } from './config';
import { resolveCredentials, resolveForgeCredential } from './credentials';
import { SESSION_MAX_AGE_MS, type SessionPayload } from '@/lib/session';

// The credential a request speaks with: the header-then-session-then-
// environment cascade, where a spent grant with a live refresh behind it is not
// a credential at all but the 401 that sends the browser to mend it.
//
// The session arrives as a plain payload, the way `sessionMiddleware` hands it
// down — reading and unsealing the cookie is the middleware's job, covered in
// `src/lib/server/session/`. The deployment is constructed per case as a plain
// config value.

const HOUR = 60 * 60 * 1000;

/** A request that names no credential, or one on a Bearer header. */
function request(authorization?: string): Request {
  return new Request('https://ghdiff.com/api/diff', {
    headers: authorization == null ? {} : { authorization },
  });
}

describe('resolveCredentials', () => {
  it('resolves nothing for a request that names no credential', async () => {
    assert.deepEqual(
      await resolveCredentials(parseDeploymentConfig({}), undefined, request()),
      {
        byForge: { github: { token: undefined, fromSession: false } },
        refreshDue: false,
      }
    );
  });

  it('honours a Bearer header ahead of the session and the environment', async () => {
    const now = Date.now();
    const session: SessionPayload = {
      issuedAt: now,
      github: { accessToken: 'ghu_cookie', accessExpiresAt: now + HOUR },
    };

    const resolved = await resolveCredentials(
      parseDeploymentConfig({ GITHUB_TOKEN: 'ghu_env' }),
      session,
      request('Bearer ghp_header')
    );
    // A caller that named a credential meant that one.
    assert.deepEqual(resolved.byForge, {
      github: { token: 'ghp_header', fromSession: false },
    });
    assert.equal(resolved.headerToken, 'ghp_header');
    assert.equal(resolved.refreshDue, false);
  });

  it('falls back to GITHUB_TOKEN when nothing else speaks', async () => {
    const resolved = await resolveCredentials(
      parseDeploymentConfig({ GITHUB_TOKEN: 'ghu_env' }),
      undefined,
      request()
    );
    assert.deepEqual(resolved.byForge.github, {
      token: 'ghu_env',
      fromSession: false,
    });
    assert.equal(resolved.headerToken, undefined);
    assert.equal(resolved.refreshDue, false);
  });

  it("reads a live GitHub token out of the session as the session's own", async () => {
    const now = Date.now();
    const session: SessionPayload = {
      issuedAt: now,
      github: { accessToken: 'ghu_cookie', accessExpiresAt: now + HOUR },
    };

    const resolved = await resolveCredentials(
      parseDeploymentConfig({ GITHUB_TOKEN: 'ghu_env' }),
      session,
      request()
    );
    // The session outranks the environment, and only it is a session.
    assert.deepEqual(resolved.byForge.github, {
      token: 'ghu_cookie',
      fromSession: true,
    });
    assert.equal(resolved.headerToken, undefined);
  });

  it('reports refresh-due for a spent GitHub grant with a live refresh', async () => {
    const now = Date.now();
    const session: SessionPayload = {
      issuedAt: now,
      github: {
        accessToken: 'ghu_dead',
        accessExpiresAt: now - HOUR,
        refreshToken: 'ghr_live',
        refreshExpiresAt: now + HOUR,
      },
    };

    const resolved = await resolveCredentials(
      parseDeploymentConfig({}),
      session,
      request()
    );
    assert.deepEqual(resolved.byForge, {
      github: { token: undefined, fromSession: false },
    });
    assert.equal(resolved.refreshDue, true);
  });

  it('honours nothing in a session that is past the ceiling', async () => {
    const now = Date.now();
    const session: SessionPayload = {
      issuedAt: now - SESSION_MAX_AGE_MS - HOUR,
      github: { accessToken: 'ghu_cookie', accessExpiresAt: now + HOUR },
    };

    const resolved = await resolveCredentials(
      parseDeploymentConfig({}),
      session,
      request()
    );
    assert.deepEqual(resolved.byForge, {
      github: { token: undefined, fromSession: false },
    });
    assert.equal(resolved.refreshDue, false);
  });
});

describe('resolveForgeCredential', () => {
  it('lets a Bearer header speak', async () => {
    const { cred, refreshDue } = await resolveForgeCredential(
      parseDeploymentConfig({}),
      undefined,
      request('Bearer ghp_abc')
    );
    assert.deepEqual(cred, { token: 'ghp_abc', fromSession: false });
    assert.equal(refreshDue, false);
  });

  it("answers with the session token, marked as the session's", async () => {
    const now = Date.now();
    const session: SessionPayload = {
      issuedAt: now,
      github: { accessToken: 'ghu_cookie', accessExpiresAt: now + HOUR },
    };

    const { cred, refreshDue } = await resolveForgeCredential(
      parseDeploymentConfig({}),
      session,
      request()
    );
    assert.deepEqual(cred, { token: 'ghu_cookie', fromSession: true });
    assert.equal(refreshDue, false);
  });

  it('answers a spent session with a live refresh as refresh-due', async () => {
    const now = Date.now();
    const session: SessionPayload = {
      issuedAt: now,
      github: {
        accessToken: 'ghu_dead',
        accessExpiresAt: now - HOUR,
        refreshToken: 'ghr_live',
        refreshExpiresAt: now + HOUR,
      },
    };

    const { cred, refreshDue } = await resolveForgeCredential(
      parseDeploymentConfig({}),
      session,
      request()
    );
    assert.deepEqual(cred, { token: undefined, fromSession: false });
    assert.equal(refreshDue, true);
  });
});
