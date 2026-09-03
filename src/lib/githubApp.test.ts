import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AUTH_ERROR_PARAM,
  authFailureMessage,
  authFailureUrl,
  authorizeUrl,
  callbackUrl,
  CALLBACK_PATH,
  installUrl,
} from './githubApp.ts';

const CLIENT_ID = 'Iv23liTestClientId';

describe('callbackUrl', () => {
  it('answers on the origin the request arrived on', () => {
    // Derived rather than configured, so one App registered with both callback
    // URLs serves ghdiff.com and a laptop and neither is sent to the other's.
    assert.equal(
      callbackUrl('https://ghdiff.com/owner/repo/pull/1'),
      `https://ghdiff.com${CALLBACK_PATH}`
    );
    assert.equal(
      callbackUrl('http://localhost:3000/'),
      `http://localhost:3000${CALLBACK_PATH}`
    );
  });
});

describe('authorizeUrl', () => {
  const url = new URL(
    authorizeUrl({
      challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      clientId: CLIENT_ID,
      redirectUri: `https://ghdiff.com${CALLBACK_PATH}`,
      state: 'a-state',
    })
  );

  it("opens GitHub's own authorize page", () => {
    assert.equal(url.origin, 'https://github.com');
    assert.equal(url.pathname, '/login/oauth/authorize');
  });

  it('names the App, where to come back to, and the state', () => {
    assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(
      url.searchParams.get('redirect_uri'),
      `https://ghdiff.com${CALLBACK_PATH}`
    );
    assert.equal(url.searchParams.get('state'), 'a-state');
  });

  it('asks for PKCE, with the only method GitHub takes', () => {
    assert.equal(
      url.searchParams.get('code_challenge'),
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    );
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  });

  it('never carries the secret', () => {
    // The secret belongs to the exchange, which happens Worker to GitHub. This
    // URL goes through the reviewer's browser.
    assert.equal(url.searchParams.get('client_secret'), null);
  });
});

describe('installUrl', () => {
  it('opens the install page for the App by its slug', () => {
    assert.equal(
      installUrl('ghdiff'),
      'https://github.com/apps/ghdiff/installations/new'
    );
  });
});

describe('authFailureUrl', () => {
  it('puts the reason on the address and keeps the path', () => {
    assert.equal(
      authFailureUrl('/owner/repo/pull/1', 'denied'),
      `/owner/repo/pull/1?${AUTH_ERROR_PARAM}=denied`
    );
  });

  it('keeps a query and a fragment that were already there', () => {
    // Rebuilt rather than concatenated: appending would put the parameter after
    // the fragment, where nothing would ever read it.
    const url = authFailureUrl('/o/r/pull/1?a=1#diff-x.ts:R4', 'github');
    assert.equal(
      url,
      `/o/r/pull/1?a=1&${AUTH_ERROR_PARAM}=github#diff-x.ts:R4`
    );
  });
});

describe('authFailureMessage', () => {
  it('has a line for each of the four reasons', () => {
    for (const reason of ['denied', 'expired', 'mismatch', 'github']) {
      const message = authFailureMessage(reason);
      assert.equal(typeof message, 'string', reason);
      assert.ok((message ?? '').length > 0, reason);
    }
  });

  it('says nothing about a reason this app did not write', () => {
    // The value arrives in the address bar, where anybody can type one.
    assert.equal(authFailureMessage('<script>'), undefined);
    assert.equal(authFailureMessage(null), undefined);
    assert.equal(authFailureMessage('toString'), undefined);
  });
});
