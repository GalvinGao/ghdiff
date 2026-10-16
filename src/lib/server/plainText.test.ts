import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { textResponse } from './plainText';
import { failureFromHeaders } from '@/lib/failure';

// The failure headers a plain answer rides, and the round trip the client
// reads them back with.

describe('textResponse', () => {
  it('answers text/plain, no-store, with no failure headers by default', () => {
    const response = textResponse('nope', { status: 404 });
    assert.equal(response.headers.get('content-type'), 'text/plain');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(failureFromHeaders(response.headers), null);
  });

  it('rides the failure headers when a failure is attached', () => {
    const response = textResponse('Your connection is no longer valid.', {
      status: 401,
      failure: {
        reason: 'auth-expired',
        forge: 'gitlab',
        host: 'gitlab.com',
      },
    });
    assert.deepEqual(failureFromHeaders(response.headers), {
      reason: 'auth-expired',
      forge: 'gitlab',
      host: 'gitlab.com',
    });
  });

  it('sets only the reason when the forge is not known', () => {
    const response = textResponse('Your sign-in is no longer valid.', {
      status: 401,
      failure: { reason: 'auth-expired' },
    });
    assert.deepEqual(failureFromHeaders(response.headers), {
      reason: 'auth-expired',
    });
  });
});
