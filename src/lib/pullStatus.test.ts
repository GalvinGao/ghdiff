import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkTone,
  describePullStatus,
  normalizePullStatus,
  reviewTone,
} from './pullStatus.ts';

const HEAD = 'abc123';

function source(options: {
  committedDate?: string;
  oid?: string;
  requestedAt?: string;
  reviewDecision?: string | null;
  rollup?: string | null;
}) {
  return {
    reviewDecision: options.reviewDecision ?? null,
    headRefOid: HEAD,
    commits: {
      nodes: [
        {
          commit: {
            oid: options.oid ?? HEAD,
            committedDate: options.committedDate ?? '2026-08-20T00:00:00Z',
            statusCheckRollup:
              options.rollup == null ? null : { state: options.rollup },
          },
        },
      ],
    },
    reviews: {
      nodes:
        options.requestedAt == null
          ? []
          : [{ submittedAt: options.requestedAt }],
    },
  };
}

describe('normalizePullStatus', () => {
  it('reads an approval and a passing rollup', () => {
    const status = normalizePullStatus(
      source({ reviewDecision: 'APPROVED', rollup: 'SUCCESS' })
    );
    assert.deepEqual(status, { review: 'approved', check: 'success' });
  });

  it('reads an error rollup as a failure', () => {
    assert.equal(
      normalizePullStatus(source({ rollup: 'ERROR' })).check,
      'failure'
    );
  });

  it('reads an expected rollup as pending', () => {
    assert.equal(
      normalizePullStatus(source({ rollup: 'EXPECTED' })).check,
      'pending'
    );
  });

  it('reads no rollup as no checks, which is not pending', () => {
    assert.equal(normalizePullStatus(source({ rollup: null })).check, 'none');
  });

  it('ignores a rollup that belongs to an older commit', () => {
    const status = normalizePullStatus(
      source({ oid: 'older', rollup: 'SUCCESS' })
    );
    assert.equal(status.check, 'none');
  });

  it('reads REVIEW_REQUIRED as no review yet', () => {
    assert.equal(
      normalizePullStatus(source({ reviewDecision: 'REVIEW_REQUIRED' })).review,
      'none'
    );
  });

  it('marks a push that came after the request for changes', () => {
    const status = normalizePullStatus(
      source({
        reviewDecision: 'CHANGES_REQUESTED',
        requestedAt: '2026-08-19T00:00:00Z',
        committedDate: '2026-08-20T00:00:00Z',
      })
    );
    assert.equal(status.commitsSinceChanges, true);
  });

  it('leaves the mark off when the request for changes is the newer of the two', () => {
    const status = normalizePullStatus(
      source({
        reviewDecision: 'CHANGES_REQUESTED',
        requestedAt: '2026-08-21T00:00:00Z',
        committedDate: '2026-08-20T00:00:00Z',
      })
    );
    assert.equal(status.commitsSinceChanges, undefined);
  });

  it('leaves the mark off when nobody asked for changes', () => {
    const status = normalizePullStatus(
      source({
        reviewDecision: 'APPROVED',
        requestedAt: '2026-08-19T00:00:00Z',
      })
    );
    assert.equal(status.commitsSinceChanges, undefined);
  });

  it('answers for an empty response instead of throwing', () => {
    assert.deepEqual(normalizePullStatus({}), {
      review: 'none',
      check: 'none',
    });
  });
});

describe('tones', () => {
  it('maps the review states', () => {
    assert.equal(reviewTone('approved'), 'success');
    assert.equal(reviewTone('changes'), 'failure');
    assert.equal(reviewTone('none'), 'neutral');
  });

  it('maps the check states', () => {
    assert.equal(checkTone('success'), 'success');
    assert.equal(checkTone('pending'), 'pending');
    assert.equal(checkTone('failure'), 'failure');
    assert.equal(checkTone('none'), 'neutral');
  });
});

describe('describePullStatus', () => {
  it('says both axes', () => {
    assert.equal(
      describePullStatus({ review: 'approved', check: 'success' }),
      'Approved · checks passing'
    );
  });

  it('says that the author pushed after the request for changes', () => {
    assert.equal(
      describePullStatus({
        review: 'changes',
        check: 'pending',
        commitsSinceChanges: true,
      }),
      'Changes requested, new commits since · checks running'
    );
  });
});
