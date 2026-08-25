import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeReviewFailure } from './reviewFailure.ts';

describe('describeReviewFailure', () => {
  it('asks a rate-limited browser with no token for one', () => {
    const failure = describeReviewFailure({ hasToken: false, status: 429 });
    assert.equal(failure.action, 'add-token');
    assert.match(failure.title, /rate limiting/);
  });

  it('drops the rate limit body GitHub wrote', () => {
    // The panel offers the button that GitHub's message only describes.
    const failure = describeReviewFailure({
      hasToken: false,
      message: 'API rate limit exceeded for 203.0.113.7.',
      status: 429,
    });
    assert.equal(failure.action, 'add-token');
    assert.doesNotMatch(failure.message, /203\.0\.113\.7/);
  });

  it('offers only the wait to a rate-limited token', () => {
    const failure = describeReviewFailure({ hasToken: true, status: 429 });
    assert.equal(failure.action, 'retry');
    assert.match(failure.message, /within the hour/);
  });

  it('keeps the message from the server for every other status', () => {
    const failure = describeReviewFailure({
      hasToken: false,
      message: 'Not Found',
      status: 404,
    });
    assert.equal(failure.action, 'retry');
    assert.equal(failure.message, 'Not Found');
    assert.equal(failure.title, 'Could not load that diff');
  });

  it('speaks for a request that never came back', () => {
    const failure = describeReviewFailure({ hasToken: false });
    assert.equal(failure.action, 'retry');
    assert.match(failure.message, /did not come back/);
  });

  it('does not ask a reviewer with a token to add one', () => {
    const failure = describeReviewFailure({
      hasToken: true,
      message: 'Not Found',
      status: 404,
    });
    assert.equal(failure.action, 'retry');
  });
});
