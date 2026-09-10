import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { externalRequestUrl } from './authRoute.ts';

// The URL a request arrived on from outside, behind whatever terminates TLS.

describe('externalRequestUrl', () => {
  it('upgrades an http URL when the proxy names https', () => {
    const request = new Request('http://ghdiff.com/api/auth/start?x=1', {
      headers: { 'x-forwarded-proto': 'https' },
    });
    assert.equal(
      externalRequestUrl(request),
      'https://ghdiff.com/api/auth/start?x=1'
    );
  });

  it('leaves the URL alone without the header, or already https', () => {
    assert.equal(
      externalRequestUrl(new Request('http://localhost:3000/setup')),
      'http://localhost:3000/setup'
    );
    assert.equal(
      externalRequestUrl(
        new Request('https://ghdiff.com/setup', {
          headers: { 'x-forwarded-proto': 'https' },
        })
      ),
      'https://ghdiff.com/setup'
    );
  });

  it('honours no other value, a chain among them', () => {
    for (const proto of ['http', 'ftp', 'https, http', 'HTTPS']) {
      const request = new Request('http://ghdiff.com/', {
        headers: { 'x-forwarded-proto': proto },
      });
      assert.equal(externalRequestUrl(request), 'http://ghdiff.com/', proto);
    }
  });

  it('changes nothing but the scheme', () => {
    const request = new Request('http://ghdiff.com:3000/a/b?c=d#frag', {
      headers: { 'x-forwarded-proto': 'https' },
    });
    assert.equal(
      externalRequestUrl(request),
      'https://ghdiff.com:3000/a/b?c=d#frag'
    );
  });
});
