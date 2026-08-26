import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { reviewTone } from './pullStatus.ts';
import {
  canSubmitReview,
  describeSubmittedReview,
  REVIEW_EVENTS,
  reviewEventSpec,
  reviewVerdict,
} from './reviewDecision.ts';

describe('REVIEW_EVENTS', () => {
  it('is the three GitHub takes, in its own spelling', () => {
    assert.deepEqual(
      REVIEW_EVENTS.map((spec) => spec.event),
      ['APPROVE', 'REQUEST_CHANGES', 'COMMENT']
    );
  });

  it('asks for a body for everything but an approval', () => {
    assert.equal(reviewEventSpec('APPROVE').requiresBody, false);
    assert.equal(reviewEventSpec('REQUEST_CHANGES').requiresBody, true);
    assert.equal(reviewEventSpec('COMMENT').requiresBody, true);
  });
});

describe('canSubmitReview', () => {
  it('lets an approval go with no words at all', () => {
    assert.equal(canSubmitReview('APPROVE', ''), true);
    assert.equal(canSubmitReview('APPROVE', '   '), true);
  });

  it('holds the other two until there are some', () => {
    assert.equal(canSubmitReview('REQUEST_CHANGES', ''), false);
    assert.equal(canSubmitReview('COMMENT', ''), false);
    assert.equal(canSubmitReview('COMMENT', 'looks fine'), true);
  });

  it('does not count whitespace as words', () => {
    assert.equal(canSubmitReview('REQUEST_CHANGES', ' \n\t '), false);
  });
});

describe('describeSubmittedReview', () => {
  const review = { id: 1, state: 'APPROVED' };

  it('names each verdict the app can send', () => {
    assert.equal(
      describeSubmittedReview(review),
      'You approved this pull request.'
    );
    assert.equal(
      describeSubmittedReview({ ...review, state: 'CHANGES_REQUESTED' }),
      'You requested changes on this pull request.'
    );
    assert.equal(
      describeSubmittedReview({ ...review, state: 'COMMENTED' }),
      'You commented on this pull request.'
    );
  });

  it('still reports a state it does not offer', () => {
    assert.equal(
      describeSubmittedReview({ ...review, state: 'DISMISSED' }),
      'GitHub recorded your review.'
    );
  });
});

describe('reviewVerdict', () => {
  const review = { id: 7, state: 'APPROVED' };

  it('reads the three verdicts that stand', () => {
    assert.deepEqual(reviewVerdict(review), {
      verdict: 'approved',
      label: 'Approved',
      tone: 'success',
    });
    assert.deepEqual(reviewVerdict({ ...review, state: 'CHANGES_REQUESTED' }), {
      verdict: 'changes',
      label: 'Changes requested',
      tone: 'failure',
    });
    assert.deepEqual(reviewVerdict({ ...review, state: 'COMMENTED' }), {
      verdict: 'commented',
      label: 'Commented',
      tone: 'neutral',
    });
  });

  it('paints a verdict the colour the status square paints it', () => {
    assert.equal(reviewVerdict(review)?.tone, reviewTone('approved'));
    assert.equal(
      reviewVerdict({ ...review, state: 'CHANGES_REQUESTED' })?.tone,
      reviewTone('changes')
    );
  });

  it('answers with nothing for a review that decides nothing', () => {
    // A draft the reviewer has not sent, and one GitHub has taken back.
    assert.equal(reviewVerdict({ ...review, state: 'PENDING' }), undefined);
    assert.equal(reviewVerdict({ ...review, state: 'DISMISSED' }), undefined);
  });

  it('answers with nothing when there is no review at all', () => {
    assert.equal(reviewVerdict(undefined), undefined);
  });
});
