import assert from 'node:assert/strict';
// reviews.submit and reviews.mine — verdicts, draft publishing, and the
// refusal states. Verdict tests run on MR 3/MR 2, away from the user's
// MR 1 drafts.
import { afterAll, test } from 'vitest';

import {
  rpc,
  gl,
  ref,
  discussions,
  draftNotes,
  VIEWER,
  MARK,
  isIsoDate,
  cleanupOwn,
  type GlApprovals,
} from './helpers';
import type { CommentPayload } from '@/lib/comments';
import type { SubmittedReview } from '@/lib/reviewDecision';

afterAll(() => cleanupOwn([2, 3]));

test('COMMENT with nothing staged is a plain note on the merge request', async () => {
  const r = await rpc<SubmittedReview>('reviews/submit', {
    ...ref(3),
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
  assert.match(r.json.htmlUrl ?? '', /#note_\d+$/);

  const discs = await discussions(3);
  assert.ok(
    discs.some((d) =>
      d.notes.some(
        (n) => n.body === `${MARK} verdict note` && n.position == null
      )
    ),
    'verdict note not on GitLab'
  );
});

test('COMMENT publishes a staged draft with the verdict', async () => {
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

  const drafts = await draftNotes(3);
  assert.ok(
    !drafts.some((n) => n.id === draft.json.remoteId),
    'draft was not published'
  );
  const discs = await discussions(3);
  assert.ok(
    discs.some((d) =>
      d.notes.some(
        (n) =>
          n.type === 'DiffNote' &&
          n.body === `${MARK} staged for the verdict` &&
          n.position?.new_line === 5
      )
    ),
    'published draft is not a DiffNote on GitLab'
  );

  assert.ok(
    discs.some((d) =>
      d.notes.some((n) => n.body === `${MARK} summary` && n.position == null)
    ),
    'verdict note was not posted as its own call'
  );
});

test('a verdict over a poison draft fails explained, drafts kept', async () => {
  // A draft on a context line can never be placed by the instance: the whole
  // publish 500s, and the forge must answer with the likely cause rather
  // than the bare status — and leave the staging in place for the retry.
  const draft = await rpc<CommentPayload>('drafts/create', {
    ...ref(2),
    path: 'src/utils.ts',
    line: 12,
    side: 'additions',
    body: `${MARK} poison (context line)`,
  });
  assert.ok(draft.ok, draft.raw);

  const r = await rpc('reviews/submit', {
    ...ref(2),
    event: 'COMMENT',
    body: `${MARK} should fail explained`,
  });
  assert.ok(!r.ok, `poison verdict answered ${r.status}`);
  assert.match(r.raw, /outside the diff/, r.raw.slice(0, 200));
  const drafts = await draftNotes(2);
  assert.ok(
    drafts.some((n) => n.id === draft.json.remoteId),
    'the staging did not survive for the retry'
  );
  await rpc('drafts/remove', { ...ref(2), id: draft.json.remoteId });
});

test('APPROVE registers, reads back through reviews.mine, and unapproves', async () => {
  const r = await rpc<SubmittedReview>('reviews/submit', {
    ...ref(2),
    event: 'APPROVE',
  });
  assert.ok(r.ok, r.raw);
  assert.equal(r.json.state, 'APPROVED');

  const approvals = await gl<GlApprovals>('GET', '/merge_requests/2/approvals');
  assert.ok(
    approvals.approved_by?.some((a) => a.user?.username === VIEWER.username),
    'not in approved_by'
  );

  const mine = await rpc<{ review?: SubmittedReview }>('reviews/mine', ref(2));
  assert.ok(mine.ok, mine.raw);
  assert.equal(mine.json.review?.state, 'APPROVED');

  await gl('POST', '/merge_requests/2/unapprove');
  const unapproved = await gl<GlApprovals>(
    'GET',
    '/merge_requests/2/approvals'
  );
  assert.ok(
    !unapproved.approved_by?.some((a) => a.user?.username === VIEWER.username),
    'unapprove cleanup failed'
  );
});

test('a repeated approval is the success it is on GitLab', async () => {
  const first = await rpc('reviews/submit', { ...ref(2), event: 'APPROVE' });
  assert.ok(first.ok, first.raw);
  const second = await rpc<SubmittedReview>('reviews/submit', {
    ...ref(2),
    event: 'APPROVE',
  });
  assert.ok(second.ok, second.raw);
  assert.equal(second.json.state, 'APPROVED');
  const approvals = await gl<GlApprovals>('GET', '/merge_requests/2/approvals');
  assert.ok(
    approvals.approved_by?.some((a) => a.user?.username === VIEWER.username)
  );
  await gl('POST', '/merge_requests/2/unapprove');
});

test('REQUEST_CHANGES is refused on GitLab', async () => {
  const r = await rpc('reviews/submit', {
    ...ref(1),
    event: 'REQUEST_CHANGES',
    body: `${MARK} should never land`,
  });
  assert.ok(!r.ok, `answered ${r.status}`);
});

test('COMMENT with an empty body and nothing staged is refused', async () => {
  const r = await rpc('reviews/submit', {
    ...ref(3),
    event: 'COMMENT',
    body: '',
  });
  assert.ok(!r.ok, `answered ${r.status}`);
  assert.match(r.raw, /needs words/i);
});
