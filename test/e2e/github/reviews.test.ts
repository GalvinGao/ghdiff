import assert from 'node:assert/strict';
// reviews.submit and reviews.mine — verdicts, draft publishing, and the
// refusal states. The token owner authored every fixture PR, so the
// own-pull-request rule is what gets exercised for the restricted verdicts.
import { afterAll, test } from 'vitest';

import {
  rpc,
  ref,
  reviewComments,
  reviews,
  MARK,
  isIsoDate,
  cleanupOwn,
} from './helpers';
import type { CommentPayload } from '@/lib/comments';
import type { SubmittedReview } from '@/lib/reviewDecision';

afterAll(() => cleanupOwn([1, 3]));

test('COMMENT submits as its own review and reviews.mine reads it back', async () => {
  const r = await rpc<SubmittedReview>('reviews/submit', {
    ...ref(1),
    event: 'COMMENT',
    body: `${MARK} verdict note`,
  });
  assert.ok(r.ok, r.raw);
  assert.equal(r.json.state, 'COMMENTED');
  assert.equal(typeof r.json.id, 'number');
  assert.ok(
    isIsoDate(r.json.submittedAt),
    `submittedAt: ${r.json.submittedAt}`
  );
  assert.match(r.json.htmlUrl ?? '', /#pullrequestreview-\d+/);

  const onGitHub = await reviews(1);
  assert.ok(
    onGitHub.some(
      (x) => x.state === 'COMMENTED' && x.body === `${MARK} verdict note`
    ),
    'review not on GitHub'
  );

  const mine = await rpc<{ review?: SubmittedReview }>('reviews/mine', ref(1));
  assert.ok(mine.ok, mine.raw);
  assert.equal(mine.json.review?.state, 'COMMENTED');
});

test('COMMENT publishes the staged drafts with the verdict', async () => {
  const draft = await rpc<CommentPayload>('drafts/create', {
    ...ref(3),
    path: 'src/settings-panel.ts',
    line: 5,
    side: 'additions',
    body: `${MARK} staged for the verdict`,
  });
  assert.ok(draft.ok, draft.raw);

  const r = await rpc<SubmittedReview>('reviews/submit', {
    ...ref(3),
    event: 'COMMENT',
    body: `${MARK} summary`,
  });
  assert.ok(r.ok, r.raw);
  assert.equal(r.json.state, 'COMMENTED');

  // The pending review is submitted: nothing PENDING is left, and the staged
  // comment stands as a review comment on the pull request.
  const remaining = await reviews(3);
  assert.ok(!remaining.some((x) => x.state === 'PENDING'), 'still pending');
  const onGitHub = await reviewComments(3);
  assert.ok(
    onGitHub.some((n) => n.body === `${MARK} staged for the verdict`),
    'staged comment was not published'
  );
  const summary = remaining.find((x) => x.body === `${MARK} summary`);
  assert.ok(summary, 'the verdict note is not on GitHub');
});

test('APPROVE is refused on your own pull request', async () => {
  const r = await rpc('reviews/submit', { ...ref(1), event: 'APPROVE' });
  assert.ok(!r.ok, `answered ${r.status}`);
  assert.match(r.raw, /own pull request/i, r.raw.slice(0, 300));
});

test('REQUEST_CHANGES is refused on your own pull request', async () => {
  const r = await rpc('reviews/submit', {
    ...ref(1),
    event: 'REQUEST_CHANGES',
    body: `${MARK} should never land`,
  });
  assert.ok(!r.ok, `answered ${r.status}`);
  assert.match(r.raw, /own pull request/i, r.raw.slice(0, 300));
  // And nothing landed.
  const onGitHub = await reviews(1);
  assert.ok(!onGitHub.some((x) => x.body === `${MARK} should never land`));
});

test('COMMENT with an empty body and nothing staged is refused', async () => {
  const r = await rpc('reviews/submit', {
    ...ref(3),
    event: 'COMMENT',
    body: '',
  });
  assert.ok(!r.ok, `answered ${r.status}`);
});
