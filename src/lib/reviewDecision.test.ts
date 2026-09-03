import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { reviewTone } from './pullStatus.ts';
import {
  canSubmitReview,
  isOwnPullRequest,
  reviewBlock,
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

describe('reviewBlock', () => {
  const other = { ownPullRequest: false };
  const own = { ownPullRequest: true };

  it("lets an approval through with no note, on somebody else's", () => {
    assert.equal(
      reviewBlock({ ...other, event: 'APPROVE', body: '' }),
      undefined
    );
  });

  it('asks for a note before a change request or a comment', () => {
    assert.equal(
      reviewBlock({ ...other, event: 'REQUEST_CHANGES', body: '' }),
      'needs-note'
    );
    assert.equal(
      reviewBlock({ ...other, event: 'COMMENT', body: ' \n\t ' }),
      'needs-note'
    );
    assert.equal(
      reviewBlock({ ...other, event: 'COMMENT', body: 'looks fine' }),
      undefined
    );
  });

  it('refuses an approval and a change request on your own', () => {
    // GitHub will not take either from the person who opened it, and answers a
    // 422 if asked. This is what stops the button offering it.
    assert.equal(
      reviewBlock({ ...own, event: 'APPROVE', body: '' }),
      'own-pull-request'
    );
    assert.equal(
      reviewBlock({ ...own, event: 'REQUEST_CHANGES', body: 'do this' }),
      'own-pull-request'
    );
  });

  it('reports the ownership before the note, never the other way round', () => {
    // The order is the whole point. A note would not help, so telling a
    // reviewer to write one sends them to do work that changes nothing.
    assert.equal(
      reviewBlock({ ...own, event: 'REQUEST_CHANGES', body: '' }),
      'own-pull-request'
    );
  });

  it('still takes a comment on your own, once there is a note', () => {
    // The one verdict GitHub allows on your own pull request.
    assert.equal(
      reviewBlock({ ...own, event: 'COMMENT', body: '' }),
      'needs-note'
    );
    assert.equal(
      reviewBlock({ ...own, event: 'COMMENT', body: 'noting this' }),
      undefined
    );
  });

  it('agrees with canSubmitReview everywhere', () => {
    for (const event of ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] as const) {
      for (const body of ['', 'a note']) {
        for (const ownPullRequest of [false, true]) {
          assert.equal(
            canSubmitReview(event, body, ownPullRequest),
            reviewBlock({ body, event, ownPullRequest }) == null,
            `${event} body=${JSON.stringify(body)} own=${ownPullRequest}`
          );
        }
      }
    }
  });
});

describe('isOwnPullRequest', () => {
  it('matches whatever case either side is written in', () => {
    assert.equal(isOwnPullRequest('GalvinGao', 'galvingao'), true);
    assert.equal(isOwnPullRequest('galvingao', 'GALVINGAO'), true);
  });

  it('says no for a different author', () => {
    assert.equal(isOwnPullRequest('somebody-else', 'GalvinGao'), false);
  });

  it('says no when either side is unknown', () => {
    // The safe default. Guessing yes would grey out two buttons on somebody
    // else's pull request, for a reason the reviewer could not see.
    assert.equal(isOwnPullRequest(undefined, 'GalvinGao'), false);
    assert.equal(isOwnPullRequest('GalvinGao', undefined), false);
    assert.equal(isOwnPullRequest(undefined, undefined), false);
  });
});
