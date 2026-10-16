import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  authExpiredMessage,
  FAILURE_FORGE_HEADER,
  FAILURE_HEADER,
  failureForStatus,
  failureFromHeaders,
  isFailureMeta,
} from './failure';

// The typed failure's two halves: the headers a plain route sets and the
// client reads back, and the status mapping for the throw sites that only
// have a status.

describe('failureFromHeaders', () => {
  it('reads the reason and the forge back', () => {
    const headers = new Headers({
      [FAILURE_HEADER]: 'auth-expired',
      [FAILURE_FORGE_HEADER]: 'github',
    });
    assert.deepEqual(failureFromHeaders(headers), {
      reason: 'auth-expired',
      forge: 'github',
    });
  });

  it('answers null when the answer names no reason', () => {
    assert.equal(failureFromHeaders(new Headers()), null);
  });

  it('answers null for a reason it does not know', () => {
    const headers = new Headers({ [FAILURE_HEADER]: 'teapot' });
    assert.equal(failureFromHeaders(headers), null);
  });

  it('leaves the forge out when the header names none', () => {
    const headers = new Headers({ [FAILURE_HEADER]: 'rate-limited' });
    assert.deepEqual(failureFromHeaders(headers), {
      reason: 'rate-limited',
    });
  });
});

describe('failureForStatus', () => {
  it('reads an anonymous 401 as auth-required and a credentialed one as auth-expired', () => {
    assert.equal(
      failureForStatus(401, { credentialed: false })?.reason,
      'auth-required'
    );
    assert.equal(
      failureForStatus(401, { credentialed: true })?.reason,
      'auth-expired'
    );
  });

  it('carries the forge it is given', () => {
    assert.deepEqual(
      failureForStatus(403, { forge: 'github', credentialed: true }),
      { reason: 'permission-denied', forge: 'github' }
    );
  });

  it('maps the remaining statuses and leaves the rest untyped', () => {
    assert.equal(
      failureForStatus(404, { credentialed: false })?.reason,
      'not-found'
    );
    assert.equal(
      failureForStatus(429, { credentialed: false })?.reason,
      'rate-limited'
    );
    assert.equal(
      failureForStatus(400, { credentialed: false })?.reason,
      'bad-request'
    );
    assert.equal(failureForStatus(500, { credentialed: false }), undefined);
    assert.equal(failureForStatus(413, { credentialed: false }), undefined);
  });
});

describe('isFailureMeta', () => {
  it('accepts a FailureMeta and refuses the shapes around it', () => {
    assert.equal(isFailureMeta({ reason: 'not-served' }), true);
    assert.equal(isFailureMeta({ reason: 'nope' }), false);
    assert.equal(isFailureMeta(null), false);
    assert.equal(isFailureMeta('auth-expired'), false);
  });
});

describe('authExpiredMessage', () => {
  it('names the forge, and no forge when the gate cannot know it', () => {
    assert.match(authExpiredMessage('github'), /GitHub/);
    // The RPC edge cannot tell which grant died.
    assert.doesNotMatch(authExpiredMessage(), /GitHub/);
  });
});
