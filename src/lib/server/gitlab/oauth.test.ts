import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vitest';

import {
  exchangeGitLabCode,
  GITLAB_REFRESH_ALREADY_SPENT,
  refreshGitLabGrant,
  revokeGitLabToken,
} from './oauth';
import type { GitLabHostConfig } from '@/lib/server/config';
import { OAuthError } from '@/lib/server/oauth';

// The three calls a GitLab OAuth application makes about its own credentials,
// against a `fetch` that records what it was sent and answers as the case
// says. What is asserted is the request — the instance's own host, the form,
// the headers — and what the answer becomes: a grant with absolute moments, or
// an `OAuthError` carrying GitLab's own code. The one code worth a name is
// `invalid_grant`, which is what a refresh token that was already spent reads
// as, and what the refresh route treats as a lost race rather than a session
// to end.

const NOW = 1_800_000_000_000;

const INSTANCE: GitLabHostConfig = {
  host: 'gitlab.corp.com',
  clientId: 'app-id',
  clientSecret: 'app-secret',
};

/** What the fetch stand-in was asked, one entry per send. */
interface Sent {
  url: string;
  method: string;
  headers: Headers;
  form: URLSearchParams;
  cache?: RequestCache;
}

const realFetch = globalThis.fetch;

/** A GitLab that records the one request it gets and answers it as given. */
function gitlab(answer: () => Response): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    sent.push({
      url:
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      form: new URLSearchParams(String(init?.body ?? '')),
      cache: init?.cache,
    });
    return answer();
  }) as typeof fetch;
  return sent;
}

/** A token endpoint's JSON body, answered 200. */
function granted(body: unknown): () => Response {
  return () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
}

/**
 * A token endpoint's refusal: a failure status with a JSON body. Doorkeeper
 * answers token errors this way — a 4xx with the RFC 6749 fields — and not
 * with GitHub's 200-with-an-error-field.
 */
function refused(status: number, body: unknown): () => Response {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

/**
 * Asserts the code and the sentence a refused call surfaces with. An
 * app-authored sentence is pinned by the fragment that carries its meaning;
 * the instance's own sentence, passed through untouched, is pinned whole.
 */
async function expectAuthError(
  promise: Promise<unknown>,
  expected: { code: string; message?: string | { fragment: string } }
): Promise<void> {
  const error: unknown = await promise.catch((cause: unknown) => cause);
  assert.ok(error instanceof OAuthError);
  assert.equal(error.code, expected.code);
  if (typeof expected.message === 'string') {
    assert.equal(error.message, expected.message);
  } else if (expected.message != null) {
    assert.ok(
      error.message.includes(expected.message.fragment),
      `Expected ${JSON.stringify(error.message)} to contain ${JSON.stringify(
        expected.message.fragment
      )}`
    );
  }
}

function exchange(instance: GitLabHostConfig): Promise<unknown> {
  return exchangeGitLabCode({
    host: instance.host,
    instance,
    code: 'the-code',
    redirectUri: 'https://ghdiff.com/api/auth/callback',
    verifier: 'the-verifier',
    now: NOW,
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('exchangeGitLabCode', () => {
  it("posts the code grant to the instance's own token endpoint", async () => {
    const host = 'gitlab.corp.com:8443';
    const sent = gitlab(
      granted({
        access_token: 'gloas-access',
        expires_in: 7200,
        refresh_token: 'gloas-refresh',
      })
    );

    const grant = await exchangeGitLabCode({
      host,
      instance: { ...INSTANCE, host },
      code: 'the-code',
      redirectUri: 'https://ghdiff.com/api/auth/callback',
      verifier: 'the-verifier',
      now: NOW,
    });

    assert.equal(sent.length, 1);
    const call = sent[0];
    assert.equal(call.url, `https://${host}/oauth/token`);
    assert.equal(call.method, 'POST');
    assert.equal(call.cache, 'no-store');
    assert.equal(call.headers.get('accept'), 'application/json');
    assert.equal(
      call.headers.get('content-type'),
      'application/x-www-form-urlencoded'
    );
    // workerd sends no User-Agent of its own, and a forge refuses a request
    // that names nobody.
    assert.equal(call.headers.get('user-agent'), 'ghdiff');
    assert.deepEqual(Object.fromEntries(call.form), {
      client_id: 'app-id',
      client_secret: 'app-secret',
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'https://ghdiff.com/api/auth/callback',
      code_verifier: 'the-verifier',
    });
    // A life in seconds becomes the moment it ends: a duration is only true
    // at the moment it was read, and the cookie outlives that moment.
    assert.deepEqual(grant, {
      type: 'oauth',
      accessToken: 'gloas-access',
      accessExpiresAt: NOW + 7200 * 1000,
      refreshToken: 'gloas-refresh',
    });
  });

  it('keeps only the life the answer states', async () => {
    gitlab(granted({ access_token: 'gloas-access' }));

    const grant = await exchangeGitLabCode({
      host: INSTANCE.host,
      instance: INSTANCE,
      code: 'the-code',
      redirectUri: 'https://ghdiff.com/api/auth/callback',
      verifier: 'the-verifier',
      now: NOW,
    });

    assert.ok(grant.type === 'oauth');
    assert.equal(grant.accessToken, 'gloas-access');
    // An unstated life reads as no moment, never as now.
    assert.equal(grant.accessExpiresAt, undefined);
    assert.equal(grant.refreshToken, undefined);
  });
});

describe('refreshGitLabGrant', () => {
  it('posts the refresh token and nothing else of the grant', async () => {
    const sent = gitlab(
      granted({
        access_token: 'fresh-access',
        expires_in: 7200,
        refresh_token: 'fresh-refresh',
      })
    );

    const grant = await refreshGitLabGrant({
      host: INSTANCE.host,
      instance: INSTANCE,
      refreshToken: 'spent-refresh',
      now: NOW,
    });

    assert.deepEqual(Object.fromEntries(sent[0].form), {
      client_id: 'app-id',
      client_secret: 'app-secret',
      grant_type: 'refresh_token',
      refresh_token: 'spent-refresh',
    });
    assert.deepEqual(grant, {
      type: 'oauth',
      accessToken: 'fresh-access',
      accessExpiresAt: NOW + 7200 * 1000,
      refreshToken: 'fresh-refresh',
    });
  });

  it('reads an empty refresh token and a non-numeric life as unstated', async () => {
    gitlab(
      granted({
        access_token: 'gloas-access',
        expires_in: '7200',
        refresh_token: '',
      })
    );

    const grant = await refreshGitLabGrant({
      host: INSTANCE.host,
      instance: INSTANCE,
      refreshToken: 'spent-refresh',
      now: NOW,
    });

    assert.ok(grant.type === 'oauth');
    assert.equal(grant.accessToken, 'gloas-access');
    // An unstated life reads as no moment, never as now.
    assert.equal(grant.accessExpiresAt, undefined);
    assert.equal(grant.refreshToken, undefined);
  });
});

describe('a grant the instance refuses', () => {
  it('is not_configured before the network is asked, for an instance with no OAuth application', async () => {
    const sent = gitlab(() => {
      throw new Error('The network must not be asked.');
    });

    for (const instance of [
      { host: 'gitlab.corp.com' },
      { host: 'gitlab.corp.com', clientId: 'app-id' },
    ]) {
      await expectAuthError(exchange(instance), {
        code: 'not_configured',
        message: { fragment: 'no GitLab OAuth application configured' },
      });
    }
    assert.equal(sent.length, 0);
  });

  it('carries http_<status> when the instance answers a failure', async () => {
    gitlab(() => new Response('Bad Gateway', { status: 502 }));

    await expectAuthError(
      refreshGitLabGrant({
        host: INSTANCE.host,
        instance: INSTANCE,
        refreshToken: 'spent-refresh',
        now: NOW,
      }),
      {
        code: 'http_502',
        message: { fragment: 'answered 502' },
      }
    );
  });

  it("carries the body's own error code, which is how a spent refresh reads", async () => {
    gitlab(
      refused(400, {
        error: 'invalid_grant',
        error_description: 'The provided authorization grant is invalid.',
      })
    );

    await expectAuthError(
      refreshGitLabGrant({
        host: INSTANCE.host,
        instance: INSTANCE,
        refreshToken: 'spent-refresh',
        now: NOW,
      }),
      {
        code: GITLAB_REFRESH_ALREADY_SPENT,
        message: 'The provided authorization grant is invalid.',
      }
    );
  });

  it('writes its own sentence when the refusal carries no description', async () => {
    gitlab(refused(400, { error: 'invalid_client' }));

    await expectAuthError(exchange(INSTANCE), {
      code: 'invalid_client',
      message: { fragment: 'refused that' },
    });
  });

  it('falls back to http_<status> when the failure body names no error', async () => {
    gitlab(refused(400, { unexpected: true }));

    await expectAuthError(exchange(INSTANCE), {
      code: 'http_400',
    });
  });

  it('refuses a 200 that holds no access token', async () => {
    for (const body of [{}, { access_token: '' }]) {
      gitlab(granted(body));
      await expectAuthError(exchange(INSTANCE), { code: 'no_access_token' });
    }
  });
});

describe('revokeGitLabToken', () => {
  it("posts the token to the instance's own revoke endpoint", async () => {
    // GitLab's revoke is idempotent by spec: 200 answers a live token and a
    // forgotten one alike, so this one case is both.
    const sent = gitlab(() => new Response(null, { status: 200 }));

    await revokeGitLabToken({
      host: INSTANCE.host,
      instance: INSTANCE,
      accessToken: 'gloas-access',
    });

    assert.equal(sent.length, 1);
    const call = sent[0];
    assert.equal(call.url, `https://${INSTANCE.host}/oauth/revoke`);
    assert.equal(call.method, 'POST');
    assert.deepEqual(Object.fromEntries(call.form), {
      client_id: 'app-id',
      client_secret: 'app-secret',
      token: 'gloas-access',
    });
  });

  it('asks nothing of an instance with no OAuth application', async () => {
    const sent = gitlab(() => {
      throw new Error('The network must not be asked.');
    });

    for (const instance of [
      { host: 'gitlab.corp.com' },
      { host: 'gitlab.corp.com', clientSecret: 'app-secret' },
    ]) {
      await revokeGitLabToken({
        host: instance.host,
        instance,
        accessToken: 'gloas-access',
      });
    }
    assert.equal(sent.length, 0);
  });

  it('fails only when the instance itself fails', async () => {
    gitlab(() => new Response(null, { status: 503 }));

    await expectAuthError(
      revokeGitLabToken({
        host: INSTANCE.host,
        instance: INSTANCE,
        accessToken: 'gloas-access',
      }),
      { code: 'http_503', message: { fragment: 'would not revoke' } }
    );
  });
});
