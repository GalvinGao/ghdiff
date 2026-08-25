import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isRateLimited, rateLimitedStatus } from './rateLimit.ts';

function headers(entries: Record<string, string> = {}): Headers {
  return new Headers(entries);
}

describe('rateLimitedStatus', () => {
  it('passes 429 through', () => {
    assert.equal(rateLimitedStatus(429, headers()), 429);
  });

  it('reads a 403 with no quota left as 429', () => {
    assert.equal(
      rateLimitedStatus(403, headers({ 'x-ratelimit-remaining': '0' })),
      429
    );
  });

  it('reads a throttled 403 as 429', () => {
    assert.equal(rateLimitedStatus(403, headers({ 'retry-after': '60' })), 429);
  });

  it('leaves a 403 with quota left alone', () => {
    assert.equal(
      rateLimitedStatus(403, headers({ 'x-ratelimit-remaining': '4231' })),
      403
    );
  });

  it('leaves a bare 403 alone', () => {
    // "Request forbidden by administrative rules", and a repository the token
    // may not read, both arrive without either header.
    assert.equal(rateLimitedStatus(403, headers()), 403);
  });

  it('leaves every other status alone', () => {
    for (const status of [404, 406, 422, 500, 502]) {
      assert.equal(
        rateLimitedStatus(status, headers({ 'x-ratelimit-remaining': '0' })),
        status
      );
    }
  });
});

describe('isRateLimited', () => {
  it('answers for 429 and nothing else', () => {
    assert.equal(isRateLimited(429), true);
    assert.equal(isRateLimited(403), false);
    assert.equal(isRateLimited(404), false);
    assert.equal(isRateLimited(undefined), false);
  });
});
