import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkApiRequest, hostAllowed, tokenMatches } from './guards.ts';

describe('hostAllowed', () => {
  it('takes the two spellings of loopback, on this port', () => {
    assert.equal(hostAllowed('127.0.0.1:7331', 7331), true);
    assert.equal(hostAllowed('localhost:7331', 7331), true);
    assert.equal(hostAllowed('LOCALHOST:7331', 7331), true);
    assert.equal(hostAllowed('[::1]:7331', 7331), true);
  });

  it('refuses a name that merely resolves here', () => {
    // This is the whole of the DNS rebinding defence: an attacker's own name
    // pointed at 127.0.0.1 arrives with their name in the Host header, and the
    // browser would otherwise treat their origin as this one.
    assert.equal(hostAllowed('rebind.example.com:7331', 7331), false);
    assert.equal(hostAllowed('ghdiff.com', 7331), false);
  });

  it('refuses another port, and no Host at all', () => {
    assert.equal(hostAllowed('127.0.0.1:7332', 7331), false);
    assert.equal(hostAllowed('127.0.0.1', 7331), false);
    assert.equal(hostAllowed(undefined, 7331), false);
  });
});

describe('tokenMatches', () => {
  it('is true only for the same string', () => {
    assert.equal(tokenMatches('abc', 'abc'), true);
    assert.equal(tokenMatches('abd', 'abc'), false);
    assert.equal(tokenMatches('ab', 'abc'), false);
    assert.equal(tokenMatches('abcd', 'abc'), false);
    assert.equal(tokenMatches(undefined, 'abc'), false);
    assert.equal(tokenMatches('', 'abc'), false);
  });
});

describe('checkApiRequest', () => {
  const good = {
    host: '127.0.0.1:7331',
    port: 7331,
    token: 'secret',
    expectedToken: 'secret',
  };

  it('allows a request from the page this server opened', () => {
    assert.deepEqual(checkApiRequest(good), { allowed: true });
  });

  it('reports the host before the token', () => {
    // A request from the wrong host is not a stale tab, and saying "reload"
    // to one would send the reader to do something that cannot help.
    const refusal = checkApiRequest({ ...good, host: 'evil.example:7331' });
    assert.equal(refusal.allowed, false);
    assert.equal(refusal.allowed === false && refusal.status, 403);
    assert.match(
      refusal.allowed === false ? refusal.message : '',
      /127\.0\.0\.1 only/
    );
  });

  it('names the likely cause of a wrong token, which is a stale tab', () => {
    const refusal = checkApiRequest({ ...good, token: 'other' });
    assert.equal(refusal.allowed, false);
    assert.match(
      refusal.allowed === false ? refusal.message : '',
      /earlier run/
    );
  });

  it('refuses a request carrying no token at all', () => {
    assert.equal(checkApiRequest({ ...good, token: undefined }).allowed, false);
  });
});
