import { ORPCError } from '@orpc/client';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { rpcFailure } from './client';

// The typed reason a failed call carries, read off the error rather than its
// wording.

describe('rpcFailure', () => {
  it('reads the failure the Worker attached', () => {
    const error = new ORPCError('UNAUTHORIZED', {
      status: 401,
      message: '401 Unauthorized',
      data: { failure: { reason: 'auth-required', forge: 'gitlab' } },
    });
    assert.deepEqual(rpcFailure(error), {
      reason: 'auth-required',
      forge: 'gitlab',
    });
  });

  it('answers nothing for an error that carries no typed failure', () => {
    assert.equal(rpcFailure(new Error('boom')), null);
    assert.equal(
      rpcFailure(new ORPCError('NOT_FOUND', { status: 404, data: {} })),
      null
    );
    assert.equal(rpcFailure(undefined), null);
  });
});
