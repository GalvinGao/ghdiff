import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  handoffClaimsSchema,
  handoffFromClaims,
  handoffToClaims,
  type SessionClaims,
  sessionClaimsSchema,
  sessionFromClaims,
  sessionToClaims,
} from './payload';
import { SESSION_MAX_AGE_MS } from '@/lib/session';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

const CLAIMS: SessionClaims = {
  iat: NOW / 1000,
  exp: (NOW + SESSION_MAX_AGE_MS) / 1000,
  auth: {
    github: {
      'github.com': {
        accessToken: 'ghu_example-access-token',
        accessExpiresAt: NOW + 8 * HOUR,
        refreshToken: 'ghr_example-refresh-token',
        refreshExpiresAt: NOW + 180 * 24 * HOUR,
      },
    },
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
  },
};

describe('sessionToClaims and sessionFromClaims', () => {
  it('round-trips a session with both forges in it', () => {
    const session = sessionFromClaims(CLAIMS);
    assert.deepEqual(session, {
      issuedAt: NOW,
      github: {
        accessToken: 'ghu_example-access-token',
        accessExpiresAt: NOW + 8 * HOUR,
        refreshToken: 'ghr_example-refresh-token',
        refreshExpiresAt: NOW + 180 * 24 * HOUR,
      },
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
    });
    // And the way back names the same claims, so what a build writes is what
    // a build reads. `CLAIMS` is also the pre-refactor claims shape verbatim:
    // the payload went from GitHub-at-the-top-level to forge-keyed, and the
    // claims JSON did not move.
    assert.deepEqual(sessionToClaims(session!), CLAIMS);
  });

  it('refuses a session with no credential in it at all', () => {
    assert.equal(
      sessionFromClaims({ iat: NOW / 1000, exp: CLAIMS.exp, auth: {} }),
      undefined
    );
    assert.equal(
      sessionFromClaims({
        iat: NOW / 1000,
        exp: CLAIMS.exp,
        auth: { gitlab: {} },
      }),
      undefined
    );
  });

  it('reads no GitHub credential from a grant under a host it does not serve', () => {
    // `auth.github` is keyed by host for the day GHES lands; a grant under
    // any other key is not a credential this deployment speaks with.
    const session = sessionFromClaims({
      iat: NOW / 1000,
      exp: CLAIMS.exp,
      auth: {
        github: { 'github.corp.example': { accessToken: 'ghu_elsewhere' } },
        gitlab: { 'gitlab.com': { type: 'pat', token: 'glpat-abc' } },
      },
    });
    assert.equal(session?.github, undefined);
    assert.deepEqual(session?.gitlab, {
      'gitlab.com': { type: 'pat', token: 'glpat-abc' },
    });
  });

  it('writes no empty maps: a GitHub-only session claims no gitlab key', () => {
    const claims = sessionToClaims({
      issuedAt: NOW,
      github: { accessToken: 'ghu_example-access-token' },
    });
    assert.deepEqual(claims, {
      iat: NOW / 1000,
      exp: (NOW + SESSION_MAX_AGE_MS) / 1000,
      auth: {
        github: {
          'github.com': { accessToken: 'ghu_example-access-token' },
        },
      },
    });
    // The bytes a pre-refactor build wrote for the same session: its mapping
    // spelled the optional fields out as undefined, which JSON drops — so the
    // two claims serializations are identical and a cookie sealed by either
    // build opens in the other.
    assert.equal(
      JSON.stringify(claims),
      JSON.stringify({
        iat: NOW / 1000,
        exp: (NOW + SESSION_MAX_AGE_MS) / 1000,
        auth: {
          github: {
            'github.com': {
              accessToken: 'ghu_example-access-token',
              accessExpiresAt: undefined,
              refreshToken: undefined,
              refreshExpiresAt: undefined,
            },
          },
        },
      })
    );
  });
});

describe('sessionClaimsSchema', () => {
  it('refuses claims with no iat, the ceiling having nowhere to anchor', () => {
    const { iat: _iat, ...without } = CLAIMS;
    assert.equal(sessionClaimsSchema.safeParse(without).success, false);
  });

  it('drops a malformed grant and keeps the good one', () => {
    const parsed = sessionClaimsSchema.safeParse({
      ...CLAIMS,
      auth: {
        gitlab: {
          'gitlab.corp.com': { type: 'pat', token: 'glpat-abc' },
          'bad.example.com': { type: 'pat' },
          'worse.example.com': 'a string, not a grant',
        },
      },
    });
    assert.equal(parsed.success, true);
    assert.deepEqual(parsed.data?.auth.gitlab, {
      'gitlab.corp.com': { type: 'pat', token: 'glpat-abc' },
      'bad.example.com': undefined,
      'worse.example.com': undefined,
    });
  });

  it('drops a malformed GitHub grant the same way', () => {
    const parsed = sessionClaimsSchema.safeParse({
      ...CLAIMS,
      auth: { github: { 'github.com': { refreshToken: 'ghr_no-access' } } },
    });
    assert.equal(parsed.success, true);
    assert.deepEqual(parsed.data?.auth.github, { 'github.com': undefined });
  });
});

describe('handoffToClaims and handoffFromClaims', () => {
  it('round-trips a handoff, GitLab host included', () => {
    const handoff = {
      state: 'state',
      verifier: 'verifier',
      returnTo: '/owner/repo/pull/1',
      forge: 'gitlab' as const,
      host: 'gitlab.corp.com',
    };
    const claims = handoffToClaims(handoff, NOW);
    assert.equal(handoffClaimsSchema.safeParse(claims).success, true);
    assert.deepEqual(handoffFromClaims(claims), handoff);
  });

  it('refuses a handoff missing any of its three parts', () => {
    const handoff = { state: 'state', verifier: 'verifier', returnTo: '/' };
    for (const missing of ['state', 'verifier', 'returnTo'] as const) {
      const partial = { ...handoff, [missing]: undefined };
      assert.equal(
        handoffClaimsSchema.safeParse(partial).success,
        false,
        missing
      );
    }
  });
});
