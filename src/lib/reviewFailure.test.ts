import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeReviewFailure } from './reviewFailure.ts';

// These test the decision, not the prose. The wording is written by `agy -p`
// against the project's copy brief and is rewritten whenever it reads badly, so
// an assertion on a whole sentence would fail on every copy pass and say nothing
// about whether the panel offers the right thing. What each case checks is which
// button appears, and that the message is about the cause rather than some other
// one — a signed-in reviewer told to sign in again is the specific mistake this
// file exists to catch.

describe('describeReviewFailure', () => {
  it('offers setup to a rate-limited signed-out browser', () => {
    // "Try again" does nothing for the rest of the hour; signing in raises the
    // ceiling on the next request.
    const failure = describeReviewFailure({ signedIn: false, status: 429 });
    assert.equal(failure.action, 'setup');
    assert.match(failure.message, /60/);
  });

  it('drops the rate limit body GitHub wrote', () => {
    // The panel offers the button that GitHub's message only describes.
    const failure = describeReviewFailure({
      signedIn: false,
      message: 'API rate limit exceeded for 203.0.113.7.',
      status: 429,
    });
    assert.equal(failure.action, 'setup');
    assert.doesNotMatch(failure.message, /203\.0\.113\.7/);
  });

  it('offers only the wait to a rate-limited reviewer who is signed in', () => {
    // There is no second account to add, so the hour is all that is left.
    const failure = describeReviewFailure({ signedIn: true, status: 429 });
    assert.equal(failure.action, 'retry');
  });

  it('reads a 404 while signed out as a repository that may be private', () => {
    const failure = describeReviewFailure({
      signedIn: false,
      message: 'Not Found',
      status: 404,
    });
    assert.equal(failure.action, 'setup');
    assert.match(failure.message, /private/i);
    // GitHub's own word for it is true and useless on its own.
    assert.doesNotMatch(failure.message, /^Not Found$/);
  });

  it('never tells a signed-in reviewer to sign in again', () => {
    // The failure a personal access token never had. Their sign-in worked, and
    // sending them back to redo it is the one wrong answer here: what is missing
    // is the installation.
    const failure = describeReviewFailure({
      signedIn: true,
      message: 'Not Found',
      status: 404,
    });
    assert.equal(failure.action, 'setup');
    assert.match(failure.message, /install/i);
    assert.doesNotMatch(failure.message, /sign in/i);
  });

  it('keeps the message from the server for every other status', () => {
    const failure = describeReviewFailure({
      signedIn: false,
      message: 'Something broke upstream.',
      status: 500,
    });
    assert.equal(failure.action, 'retry');
    assert.equal(failure.message, 'Something broke upstream.');
    assert.equal(failure.title, 'Could not load the diff');
  });

  it('speaks for a request that never came back', () => {
    const failure = describeReviewFailure({ signedIn: false });
    assert.equal(failure.action, 'retry');
    assert.match(failure.message, /didn't respond/);
  });

  it('offers nothing but a retry once a reviewer is signed in and rate-limited', () => {
    // The one combination with no button worth pressing. Everything a reviewer
    // can grant leads to setup; this one leads nowhere, on purpose.
    for (const status of [429, 403]) {
      const failure = describeReviewFailure({ signedIn: true, status });
      assert.equal(failure.action, 'retry', String(status));
    }
  });
});
