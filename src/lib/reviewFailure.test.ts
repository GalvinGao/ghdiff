import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { describeReviewFailure } from './reviewFailure';

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

  it('sends a 401 to setup, whatever the screen still believes', () => {
    // The browser refreshes and asks again before the panel sees a 401, so one
    // that arrives is a refresh that failed and a session that is gone. What the
    // screen read about the sign-in before that is stale, and the next step is
    // the same either way.
    for (const signedIn of [false, true]) {
      const failure = describeReviewFailure({
        signedIn,
        message: 'Your GitHub sign-in is no longer valid.',
        status: 401,
      });
      assert.equal(failure.action, 'setup', String(signedIn));
      assert.match(failure.message, /sign-in/i);
    }
  });

  it('offers no setup path on a deployment with no GitHub App', () => {
    // Everything that would send a reviewer to `/setup` degrades to the retry:
    // the cause stays, the button that would 501 goes.
    for (const status of [429, 401, 404]) {
      for (const signedIn of [false, true]) {
        const failure = describeReviewFailure({
          signedIn,
          status,
          githubOAuth: false,
        });
        assert.equal(failure.action, 'retry', `${status} signedIn=${signedIn}`);
        assert.doesNotMatch(failure.message, /Set up access/);
      }
    }
  });

  it('keeps the cause when the setup clause goes', () => {
    // A rate limit is still about the 60, a 404 still about private-or-missing.
    const limited = describeReviewFailure({
      signedIn: false,
      status: 429,
      githubOAuth: false,
    });
    assert.match(limited.message, /60/);
    const missing = describeReviewFailure({
      signedIn: false,
      status: 404,
      githubOAuth: false,
    });
    assert.match(missing.message, /private/i);
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

// The typed path: the reason the server attached decides the panel, and the
// status is only the fallback. What each case checks is the same decision as
// above — which button, and which cause the message is about.
describe('describeReviewFailure by reason', () => {
  it('keeps the deployment’s own sentence for an unserved forge', () => {
    const failure = describeReviewFailure({
      signedIn: false,
      status: 404,
      message: 'This ghdiff serves GitHub on github.com.',
      failure: { reason: 'not-served', forge: 'github' },
    });
    assert.equal(failure.action, 'retry');
    assert.match(failure.message, /serves GitHub/);
    // The gate's 404 must not read as a missing repository.
    assert.doesNotMatch(failure.message, /private/i);
  });

  it('sends an expired GitHub grant to setup, whoever the screen believes', () => {
    for (const signedIn of [false, true]) {
      const failure = describeReviewFailure({
        signedIn,
        status: 401,
        failure: { reason: 'auth-expired', forge: 'github' },
      });
      assert.equal(failure.action, 'setup', String(signedIn));
      assert.match(failure.message, /sign-in/i);
    }
  });

  it('sends an anonymous GitHub refusal to setup with the sign-in wording', () => {
    const failure = describeReviewFailure({
      signedIn: false,
      status: 401,
      failure: { reason: 'auth-required', forge: 'github' },
    });
    assert.equal(failure.action, 'setup');
    assert.match(failure.message, /Set up access/);
  });

  it('degrades the GitHub sign-in offer with no App to offer it', () => {
    for (const reason of ['auth-expired', 'auth-required'] as const) {
      const failure = describeReviewFailure({
        signedIn: false,
        failure: { reason, forge: 'github' },
        githubOAuth: false,
      });
      assert.equal(failure.action, 'retry', reason);
      assert.doesNotMatch(failure.message, /Set up access/);
    }
  });

  it('keeps the forge’s sentence for a refused permission', () => {
    const failure = describeReviewFailure({
      signedIn: true,
      status: 403,
      message: 'Resource not accessible by integration',
      failure: { reason: 'permission-denied', forge: 'github' },
    });
    assert.equal(failure.action, 'retry');
    assert.match(failure.message, /Resource not accessible/);
  });

  it('lets the reason win over a misleading status', () => {
    // A 404 with auth-expired attached is a dead grant, not a missing diff.
    const failure = describeReviewFailure({
      signedIn: true,
      status: 404,
      failure: { reason: 'auth-expired', forge: 'github' },
    });
    assert.equal(failure.action, 'setup');
    assert.match(failure.message, /no longer valid/);
  });

  it('keeps the server’s sentence for a bad request', () => {
    const failure = describeReviewFailure({
      signedIn: false,
      status: 400,
      message: 'That review target is not valid.',
      failure: { reason: 'bad-request', forge: 'github' },
    });
    assert.equal(failure.action, 'retry');
    assert.match(failure.message, /not valid/);
  });
});
