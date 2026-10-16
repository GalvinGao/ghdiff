import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { type DeploymentConfig, parseDeploymentConfig } from './config';
import { resolveCredentials, resolveForgeCredential } from './credentials';
import type { ReviewTarget } from '@/lib/reviewTarget';
import {
  type GitLabGrant,
  SESSION_MAX_AGE_MS,
  type SessionPayload,
} from '@/lib/session';

// The credential a request speaks with, on both forges. The GitHub half is the
// header-then-session-then-environment cascade; the GitLab half is the session's
// usable grants keyed by host, where a PAT travels as `private-token`, an OAuth
// grant as a bearer, and a spent grant with a live refresh behind it is not a
// credential at all but the 401 that sends the browser to mend it.
//
// The session arrives as a plain payload, the way `sessionMiddleware` hands it
// down — reading and unsealing the cookie is the middleware's job, covered in
// `src/lib/server/session/`. The deployment is constructed per case as a plain
// config value.

const HOUR = 60 * 60 * 1000;

const GITHUB_PULL: ReviewTarget = {
  kind: 'github-pull',
  owner: 'octo',
  repo: 'hello',
  number: 7,
};
const GITLAB_MR: ReviewTarget = {
  kind: 'gitlab-mr',
  host: 'gitlab.corp.com',
  project: 'group/repo',
  number: 3,
};

function pat(token: string): GitLabGrant {
  return { type: 'pat', token };
}

function oauth(grant: {
  accessToken: string;
  accessExpiresAt?: number;
  refreshToken?: string;
  refreshExpiresAt?: number;
}): GitLabGrant {
  return { type: 'oauth', ...grant };
}

/** A deployment that serves gitlab.corp.com — the host these tests use. */
function corpConfig(
  extra: Record<string, string | undefined> = {}
): DeploymentConfig {
  return parseDeploymentConfig({
    GITLAB_HOSTS: '[{"host":"gitlab.corp.com"}]',
    ...extra,
  });
}

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
      gitlab: { 'gitlab.corp.com': pat('glpat-cookie') },
    };

    const resolved = await resolveCredentials(
      corpConfig({ GITHUB_TOKEN: 'ghu_env' }),
      session,
      request('Bearer glpat-header')
    );
    // The header answers for GitHub — a caller that named a credential
    // meant that one — and the session still answers for GitLab.
    assert.deepEqual(resolved.byForge.github, {
      token: 'glpat-header',
      fromSession: false,
    });
    assert.equal(resolved.headerToken, 'glpat-header');
    assert.deepEqual(resolved.byForge, {
      github: { token: 'glpat-header', fromSession: false },
      'gitlab:gitlab.corp.com': {
        token: 'glpat-cookie',
        scheme: 'private-token',
        fromSession: true,
      },
    });
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

  it('reads a GitLab-only session as no GitHub credential at all', async () => {
    const now = Date.now();
    const session: SessionPayload = {
      issuedAt: now,
      gitlab: { 'gitlab.corp.com': pat('glpat-abc') },
    };

    const resolved = await resolveCredentials(corpConfig(), session, request());
    assert.deepEqual(resolved.byForge.github, {
      token: undefined,
      fromSession: false,
    });
    assert.equal(resolved.refreshDue, false);
  });

  it('resolves a PAT as a private-token credential and a usable OAuth grant as a bearer', async () => {
    const now = Date.now();
    const session: SessionPayload = {
      issuedAt: now,
      gitlab: {
        'gitlab.corp.com': pat('glpat-abc'),
        'gitlab.com': oauth({
          accessToken: 'gloas-abc',
          accessExpiresAt: now + HOUR,
          refreshToken: 'gloas-refresh',
        }),
      },
    };

    const resolved = await resolveCredentials(
      parseDeploymentConfig({
        GITLAB_HOSTS: '[{"host":"gitlab.corp.com"},{"host":"gitlab.com"}]',
      }),
      session,
      request()
    );
    assert.deepEqual(resolved.byForge, {
      github: { token: undefined, fromSession: false },
      'gitlab:gitlab.corp.com': {
        token: 'glpat-abc',
        scheme: 'private-token',
        fromSession: true,
      },
      'gitlab:gitlab.com': {
        token: 'gloas-abc',
        scheme: 'bearer',
        fromSession: true,
      },
    });
    assert.equal(resolved.refreshDue, false);
  });

  it('treats an OAuth grant with no stated expiry as live', async () => {
    const now = Date.now();
    const session: SessionPayload = {
      issuedAt: now,
      gitlab: { 'gitlab.com': oauth({ accessToken: 'gloas-abc' }) },
    };

    const resolved = await resolveCredentials(
      parseDeploymentConfig({ GITLAB_HOSTS: '[{"host":"gitlab.com"}]' }),
      session,
      request()
    );
    assert.deepEqual(resolved.byForge, {
      github: { token: undefined, fromSession: false },
      'gitlab:gitlab.com': {
        token: 'gloas-abc',
        scheme: 'bearer',
        fromSession: true,
      },
    });
  });

  it('answers a spent OAuth grant with a live refresh as refresh-due, never as a credential', async () => {
    const now = Date.now();
    const session: SessionPayload = {
      issuedAt: now,
      gitlab: {
        'gitlab.com': oauth({
          accessToken: 'gloas-dead',
          accessExpiresAt: now - HOUR,
          refreshToken: 'gloas-refresh',
          refreshExpiresAt: now + HOUR,
        }),
      },
    };

    const resolved = await resolveCredentials(
      parseDeploymentConfig({ GITLAB_HOSTS: '[{"host":"gitlab.com"}]' }),
      session,
      request()
    );
    // The host is absent: there is no token to speak with, and the 401 this
    // produces is what sends the browser to mend it.
    assert.equal(Object.hasOwn(resolved.byForge, 'gitlab:gitlab.com'), false);
    assert.equal(resolved.refreshDue, true);
  });

  it('drops a spent OAuth grant that has no live refresh behind it', async () => {
    const now = Date.now();
    for (const grant of [
      oauth({ accessToken: 'gloas-dead', accessExpiresAt: now - HOUR }),
      oauth({
        accessToken: 'gloas-dead',
        accessExpiresAt: now - HOUR,
        refreshToken: 'gloas-refresh',
        refreshExpiresAt: now - HOUR,
      }),
    ]) {
      const session: SessionPayload = {
        issuedAt: now,
        gitlab: { 'gitlab.com': grant },
      };
      const resolved = await resolveCredentials(
        parseDeploymentConfig({ GITLAB_HOSTS: '[{"host":"gitlab.com"}]' }),
        session,
        request()
      );
      assert.deepEqual(resolved.byForge, {
        github: { token: undefined, fromSession: false },
      });
      assert.equal(resolved.refreshDue, false);
    }
  });

  it('honours no grant for a host the deployment does not serve', async () => {
    const now = Date.now();
    const session: SessionPayload = {
      issuedAt: now,
      gitlab: {
        'gitlab.corp.com': pat('glpat-abc'),
        'elsewhere.example.com': oauth({
          accessToken: 'gloas-dead',
          accessExpiresAt: now - HOUR,
          refreshToken: 'gloas-refresh',
          refreshExpiresAt: now + HOUR,
        }),
      },
    };

    const resolved = await resolveCredentials(corpConfig(), session, request());
    // The configured host's grant answers; the other is inert — no
    // credential, and its staleness is nothing to refresh.
    assert.deepEqual(resolved.byForge, {
      github: { token: undefined, fromSession: false },
      'gitlab:gitlab.corp.com': {
        token: 'glpat-abc',
        scheme: 'private-token',
        fromSession: true,
      },
    });
    assert.equal(resolved.refreshDue, false);
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
      gitlab: { 'gitlab.corp.com': pat('glpat-abc') },
    };

    const resolved = await resolveCredentials(
      parseDeploymentConfig({}),
      session,
      request()
    );
    // The GitHub half is spent, and on a deployment that serves no GitLab
    // host the GitLab grant is inert: not a credential, and nothing to
    // refresh.
    assert.deepEqual(resolved.byForge.github, {
      token: undefined,
      fromSession: false,
    });
    assert.equal(resolved.refreshDue, true);
    assert.deepEqual(resolved.byForge, {
      github: { token: undefined, fromSession: false },
    });
  });

  it('honours nothing in a session that is past the ceiling', async () => {
    const now = Date.now();
    const session: SessionPayload = {
      issuedAt: now - SESSION_MAX_AGE_MS - HOUR,
      github: { accessToken: 'ghu_cookie', accessExpiresAt: now + HOUR },
      gitlab: { 'gitlab.corp.com': pat('glpat-abc') },
    };

    const resolved = await resolveCredentials(corpConfig(), session, request());
    assert.deepEqual(resolved.byForge.github, {
      token: undefined,
      fromSession: false,
    });
    assert.deepEqual(resolved.byForge, {
      github: { token: undefined, fromSession: false },
    });
    assert.equal(resolved.refreshDue, false);
  });

  it('reads no grants when the request carries no session', async () => {
    const resolved = await resolveCredentials(
      corpConfig(),
      undefined,
      request()
    );
    assert.deepEqual(resolved.byForge.github, {
      token: undefined,
      fromSession: false,
    });
    assert.deepEqual(resolved.byForge, {
      github: { token: undefined, fromSession: false },
    });
    assert.equal(resolved.refreshDue, false);
  });
});

describe('resolveForgeCredential', () => {
  it('lets a Bearer header speak for a GitLab target, ahead of the session', async () => {
    const now = Date.now();
    const session: SessionPayload = {
      issuedAt: now,
      gitlab: { 'gitlab.corp.com': pat('glpat-cookie') },
    };

    const { cred, refreshDue } = await resolveForgeCredential(
      parseDeploymentConfig({}),
      session,
      request('Bearer glpat-header'),
      GITLAB_MR
    );
    assert.deepEqual(cred, { token: 'glpat-header', scheme: 'bearer' });
    assert.equal(refreshDue, false);
  });

  it("answers a GitLab target with the session's grant for its own host", async () => {
    const now = Date.now();
    const session: SessionPayload = {
      issuedAt: now,
      gitlab: {
        'gitlab.corp.com': pat('glpat-abc'),
        'gitlab.com': oauth({
          accessToken: 'gloas-abc',
          accessExpiresAt: now + HOUR,
        }),
      },
    };

    const { cred, refreshDue } = await resolveForgeCredential(
      parseDeploymentConfig({
        GITLAB_HOSTS: '[{"host":"gitlab.corp.com"},{"host":"gitlab.com"}]',
      }),
      session,
      request(),
      GITLAB_MR
    );
    // The host key selects: the gitlab.com grant is no credential here.
    assert.deepEqual(cred, {
      token: 'glpat-abc',
      scheme: 'private-token',
      fromSession: true,
    });
    assert.equal(refreshDue, false);
  });

  it('answers a GitLab target anonymously when the grant belongs to another host', async () => {
    const now = Date.now();
    const session: SessionPayload = {
      issuedAt: now,
      gitlab: { 'gitlab.com': pat('glpat-abc') },
    };

    const { cred, refreshDue } = await resolveForgeCredential(
      parseDeploymentConfig({
        GITLAB_HOSTS: '[{"host":"gitlab.corp.com"},{"host":"gitlab.com"}]',
      }),
      session,
      request(),
      GITLAB_MR
    );
    assert.deepEqual(cred, {});
    assert.equal(refreshDue, false);
  });

  it('answers a spent GitLab grant with a live refresh as refresh-due', async () => {
    const now = Date.now();
    const session: SessionPayload = {
      issuedAt: now,
      gitlab: {
        'gitlab.corp.com': oauth({
          accessToken: 'gloas-dead',
          accessExpiresAt: now - HOUR,
          refreshToken: 'gloas-refresh',
        }),
      },
    };

    const { cred, refreshDue } = await resolveForgeCredential(
      corpConfig(),
      session,
      request(),
      GITLAB_MR
    );
    assert.deepEqual(cred, {});
    assert.equal(refreshDue, true);
  });

  it('lets a Bearer header speak for a GitHub target', async () => {
    const { cred, refreshDue } = await resolveForgeCredential(
      parseDeploymentConfig({}),
      undefined,
      request('Bearer ghp_abc'),
      GITHUB_PULL
    );
    assert.deepEqual(cred, { token: 'ghp_abc', fromSession: false });
    assert.equal(refreshDue, false);
  });

  it("answers a GitHub target with the session token, marked as the session's", async () => {
    const now = Date.now();
    const session: SessionPayload = {
      issuedAt: now,
      github: { accessToken: 'ghu_cookie', accessExpiresAt: now + HOUR },
      gitlab: { 'gitlab.corp.com': pat('glpat-abc') },
    };

    const { cred, refreshDue } = await resolveForgeCredential(
      parseDeploymentConfig({}),
      session,
      request(),
      GITHUB_PULL
    );
    // The GitLab grant in the same session never speaks to GitHub.
    assert.deepEqual(cred, { token: 'ghu_cookie', fromSession: true });
    assert.equal(refreshDue, false);
  });

  it('answers a GitHub target anonymously for a GitLab-only session', async () => {
    const now = Date.now();
    const session: SessionPayload = {
      issuedAt: now,
      gitlab: { 'gitlab.corp.com': pat('glpat-abc') },
    };

    const { cred, refreshDue } = await resolveForgeCredential(
      parseDeploymentConfig({}),
      session,
      request(),
      GITHUB_PULL
    );
    assert.deepEqual(cred, { token: undefined, fromSession: false });
    assert.equal(refreshDue, false);
  });

  it('answers a spent GitHub session with a live refresh as refresh-due', async () => {
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
      request(),
      GITHUB_PULL
    );
    assert.deepEqual(cred, { token: undefined, fromSession: false });
    assert.equal(refreshDue, true);
  });
});
