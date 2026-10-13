import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { parseDeploymentConfig } from './config';
import { OAuthError } from './oauth';
import { type Refreshers, refreshSession } from './refresh';
import { startRequestLog } from '@/lib/logger';
import {
  type GitHubGrant,
  type GitLabGrant,
  REFRESH_SKEW_MS,
  type SessionPayload,
} from '@/lib/session';

// What a refresh does with a session's due grants, against a fake instance
// that rotates the way GitLab does: spending a refresh token ends it and the
// access token beside it, and a spent one answers `invalid_grant`.

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;
const A = 'a.example.com';
const B = 'b.example.com';

const CONFIG = parseDeploymentConfig({
  GITLAB_HOSTS: JSON.stringify([
    { host: A, clientId: 'id-a', clientSecret: 'secret-a' },
    { host: B, clientId: 'id-b', clientSecret: 'secret-b' },
  ]),
});

function grant(name: string, expiresAt: number): GitLabGrant {
  return {
    type: 'oauth',
    accessToken: `access-${name}`,
    accessExpiresAt: expiresAt,
    refreshToken: `refresh-${name}`,
    refreshExpiresAt: NOW + 24 * HOUR,
  };
}

/** Both hosts' grants spent, so a refresh is due on each. */
const DUE: SessionPayload = {
  issuedAt: NOW - HOUR,
  gitlab: { [A]: grant('a0', NOW - HOUR), [B]: grant('b0', NOW - HOUR) },
};

/** The instances' side: one live refresh token per host, rotated on spend. */
function instances() {
  const live = new Map([
    [A, 'refresh-a0'],
    [B, 'refresh-b0'],
  ]);
  let minted = 0;
  return {
    live,
    spend(host: string, refreshToken: string): GitLabGrant {
      if (live.get(host) !== refreshToken) {
        throw new OAuthError('invalid_grant', 'The refresh token is spent.');
      }
      minted += 1;
      const fresh = grant(`${host}-${minted}`, NOW + 2 * HOUR);
      live.set(host, `refresh-${host}-${minted}`);
      return fresh;
    },
  };
}

function refreshers(
  spend: (host: string, refreshToken: string) => Promise<GitLabGrant>
): Refreshers {
  return {
    github: () => Promise.reject(new Error('No GitHub grant is due.')),
    gitlab: spend,
  };
}

function log() {
  return startRequestLog(new Request('https://ghdiff.com/api/auth/refresh'))
    .logger;
}

describe('refreshSession', () => {
  it('rotates every due grant and writes them all', async () => {
    const forge = instances();
    const result = await refreshSession({
      session: DUE,
      config: CONFIG,
      now: NOW,
      refreshers: refreshers(async (host, token) => forge.spend(host, token)),
      log: log(),
    });
    assert.equal(result.kind, 'write');
    if (result.kind !== 'write') return;
    for (const host of [A, B]) {
      const written: GitLabGrant | undefined = result.session.gitlab?.[host];
      assert.ok(written?.type === 'oauth');
      assert.equal(written.refreshToken, forge.live.get(host));
    }
    assert.equal(result.session.issuedAt, DUE.issuedAt);
  });

  it('leaves no tab holding a spent grant when two refresh at once', async () => {
    // Two tabs send the same cookie. The first wins A and is held there;
    // the second loses A while the first is held. Carrying on, the second
    // would win B and seal {A0, B1}, and the first, resumed, would lose B and
    // seal {A1, B0} — each cookie with one dead connection in it.
    const forge = instances();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const asked: string[] = [];

    const first = refreshSession({
      session: DUE,
      config: CONFIG,
      now: NOW,
      refreshers: refreshers(async (host, token) => {
        const fresh = forge.spend(host, token);
        if (host === A) await held;
        return fresh;
      }),
      log: log(),
    });
    const second = await refreshSession({
      session: DUE,
      config: CONFIG,
      now: NOW,
      refreshers: refreshers(async (host, token) => {
        asked.push(host);
        return forge.spend(host, token);
      }),
      log: log(),
    });
    release();

    // The loser stops at the first host it lost and writes nothing, so the
    // browser keeps the winner's cookie, which holds every live grant.
    assert.deepEqual(second, { kind: 'keep' });
    assert.deepEqual(asked, [A]);
    const winner = await first;
    assert.equal(winner.kind, 'write');
    if (winner.kind !== 'write') return;
    for (const host of [A, B]) {
      const written: GitLabGrant | undefined = winner.session.gitlab?.[host];
      assert.ok(written?.type === 'oauth');
      assert.equal(written.refreshToken, forge.live.get(host));
    }
  });

  it('keeps every grant live when two requests disagree about what is due', async () => {
    // The first request reads the clock while A is just outside the refresh
    // window, the second a moment later, inside it. Rotating only what each
    // saw as due, the first rotates B and the second rotates A and loses B:
    // each cookie then holds a grant the other spent.
    const straddling: SessionPayload = {
      issuedAt: NOW - HOUR,
      gitlab: {
        [A]: grant('a0', NOW + REFRESH_SKEW_MS + 1),
        [B]: grant('b0', NOW - HOUR),
      },
    };
    const forge = instances();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const asked: string[] = [];
    const first = refreshSession({
      session: straddling,
      config: CONFIG,
      now: NOW,
      refreshers: refreshers(async (host, token) => {
        const fresh = forge.spend(host, token);
        if (host === A) await held;
        return fresh;
      }),
      log: log(),
    });
    const second = await refreshSession({
      session: straddling,
      config: CONFIG,
      now: NOW + 2,
      refreshers: refreshers(async (host, token) => {
        asked.push(host);
        return forge.spend(host, token);
      }),
      log: log(),
    });
    release();

    assert.deepEqual(second, { kind: 'keep' });
    assert.deepEqual(asked, [A]);
    const winner = await first;
    assert.equal(winner.kind, 'write');
    if (winner.kind !== 'write') return;
    for (const host of [A, B]) {
      const written: GitLabGrant | undefined = winner.session.gitlab?.[host];
      assert.ok(written?.type === 'oauth');
      assert.equal(written.refreshToken, forge.live.get(host));
    }
  });

  it('contests the GitHub grant first when only one request sees it due', async () => {
    const config = parseDeploymentConfig({
      GITHUB_APP_CLIENT_ID: 'Iv1.test',
      GITHUB_APP_CLIENT_SECRET: 'app-secret',
      GITLAB_HOSTS: JSON.stringify([
        { host: B, clientId: 'id-b', clientSecret: 'secret-b' },
      ]),
    });
    const github = (name: string, expiresAt: number): GitHubGrant => ({
      accessToken: `ghu_${name}`,
      accessExpiresAt: expiresAt,
      refreshToken: `ghr_${name}`,
      refreshExpiresAt: NOW + 24 * HOUR,
    });
    const session: SessionPayload = {
      issuedAt: NOW - HOUR,
      github: github('g0', NOW + REFRESH_SKEW_MS + 1),
      gitlab: { [B]: grant('b0', NOW - HOUR) },
    };
    const forge = instances();
    let liveGitHub = 'ghr_g0';
    let minted = 0;
    const spendGitHub = (token: string): GitHubGrant => {
      if (token !== liveGitHub) {
        throw new OAuthError(
          'bad_refresh_token',
          'The refresh token is spent.'
        );
      }
      minted += 1;
      liveGitHub = `ghr_g${minted}`;
      return github(`g${minted}`, NOW + 8 * HOUR);
    };
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = refreshSession({
      session,
      config,
      now: NOW,
      refreshers: {
        async github(token) {
          const fresh = spendGitHub(token);
          await held;
          return fresh;
        },
        gitlab: async (host, token) => forge.spend(host, token),
      },
      log: log(),
    });
    const second = await refreshSession({
      session,
      config,
      now: NOW + 2,
      refreshers: {
        github: async (token) => spendGitHub(token),
        gitlab: async (host, token) => forge.spend(host, token),
      },
      log: log(),
    });
    release();

    assert.deepEqual(second, { kind: 'keep' });
    const winner = await first;
    assert.equal(winner.kind, 'write');
    if (winner.kind !== 'write') return;
    assert.equal(winner.session.github?.refreshToken, liveGitHub);
    const written: GitLabGrant | undefined = winner.session.gitlab?.[B];
    assert.ok(written?.type === 'oauth');
    assert.equal(written.refreshToken, forge.live.get(B));
  });

  it('keeps a grant refreshed early when its refresh fails, and rotates the due one', async () => {
    const forge = instances();
    const session: SessionPayload = {
      issuedAt: NOW - HOUR,
      gitlab: {
        [A]: grant('a0', NOW + 2 * HOUR),
        [B]: grant('b0', NOW - HOUR),
      },
    };
    const result = await refreshSession({
      session,
      config: CONFIG,
      now: NOW,
      refreshers: refreshers(async (host, token) => {
        if (host === A) throw new OAuthError('server_error', 'Try later.');
        return forge.spend(host, token);
      }),
      log: log(),
    });
    assert.equal(result.kind, 'write');
    if (result.kind !== 'write') return;
    // The failed call rotated nothing, so A's grant still works.
    assert.deepEqual(result.session.gitlab?.[A], session.gitlab?.[A]);
    const written: GitLabGrant | undefined = result.session.gitlab?.[B];
    assert.ok(written?.type === 'oauth');
    assert.equal(written.refreshToken, forge.live.get(B));
  });

  it('drops a grant the instance will not refresh, and keeps the others', async () => {
    const forge = instances();
    const result = await refreshSession({
      session: DUE,
      config: CONFIG,
      now: NOW,
      refreshers: refreshers(async (host, token) => {
        if (host === A) throw new OAuthError('invalid_client', 'Revoked.');
        return forge.spend(host, token);
      }),
      log: log(),
    });
    assert.equal(result.kind, 'write');
    if (result.kind !== 'write') return;
    assert.equal(result.session.gitlab?.[A], undefined);
    assert.ok(result.session.gitlab?.[B] != null);
  });

  it('keeps the cookie when nothing is due', async () => {
    const result = await refreshSession({
      session: {
        issuedAt: NOW,
        gitlab: { [A]: grant('a0', NOW + 2 * HOUR) },
      },
      config: CONFIG,
      now: NOW,
      refreshers: refreshers(() =>
        Promise.reject(new Error('Nothing should be spent.'))
      ),
      log: log(),
    });
    assert.deepEqual(result, { kind: 'keep' });
  });
});
