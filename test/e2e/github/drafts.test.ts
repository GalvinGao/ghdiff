import assert from 'node:assert/strict';
// drafts.create / list / remove — the forge's own staging area: the viewer's
// pending review on GitHub.
import { afterAll, test } from 'vitest';

import {
  rpc,
  gh,
  ref,
  reviewComments,
  reviews,
  VIEWER,
  MARK,
  cleanupOwn,
  type GhReviewComment,
} from './helpers';
import type { CommentPayload } from '@/lib/comments';

afterAll(() => cleanupOwn([1]));

test('drafts.create stages a thread on the pending review', async () => {
  const r = await rpc<CommentPayload>('drafts/create', {
    ...ref(1),
    path: 'src/utils.ts',
    line: 17,
    side: 'additions',
    body: `${MARK} draft`,
  });
  assert.ok(r.ok, r.raw);
  const d = r.json;
  assert.equal(d.staged, true);
  assert.equal(typeof d.remoteId, 'number');
  assert.equal(d.author, VIEWER.login);
  assert.ok(d.authorAvatarUrl?.startsWith('https://'));
  assert.equal(d.path, 'src/utils.ts');
  assert.equal(d.line, 17);
  assert.equal(d.side, 'additions');

  const pending = (await reviews(1)).find((x) => x.state === 'PENDING');
  assert.ok(pending, 'no pending review on GitHub');
  const comments = await gh<GhReviewComment[]>(
    'GET',
    `/pulls/1/reviews/${pending.id}/comments?per_page=100`
  );
  assert.ok(
    comments.some((n) => n.id === d.remoteId && n.body === `${MARK} draft`),
    'draft not on the pending review'
  );
});

test('drafts.list reads the new draft back with the author resolved', async () => {
  const created = await rpc<CommentPayload>('drafts/create', {
    ...ref(1),
    path: 'src/utils.ts',
    line: 17,
    side: 'additions',
    body: `${MARK} list read-back`,
  });
  const id = created.json.remoteId;
  const r = await rpc<{ drafts: CommentPayload[] }>('drafts/list', ref(1));
  assert.ok(r.ok, r.raw);
  const d = r.json.drafts.find((x) => x.remoteId === id);
  assert.ok(d, 'not listed');
  assert.equal(d.staged, true);
  assert.equal(d.author, VIEWER.login);
  assert.ok(d.authorAvatarUrl?.startsWith('https://'));
});

test('drafts.remove takes a draft back, here and on GitHub', async () => {
  const created = await rpc<CommentPayload>('drafts/create', {
    ...ref(1),
    path: 'src/utils.ts',
    line: 17,
    side: 'additions',
    body: `${MARK} short-lived`,
  });
  const id = created.json.remoteId;

  // GitHub addresses a draft by its GraphQL node id, not the numeric one.
  const r = await rpc<{ ok: boolean }>('drafts/remove', {
    ...ref(1),
    nodeId: created.json.remoteNodeId,
  });
  assert.ok(r.ok, r.raw);
  assert.deepEqual(r.json, { ok: true });

  const onGitHub = await reviewComments(1);
  assert.ok(!onGitHub.some((n) => n.id === id), 'still on GitHub');
  const listed = await rpc<{ drafts: CommentPayload[] }>('drafts/list', ref(1));
  assert.ok(!listed.json.drafts.some((d) => d.remoteId === id), 'still listed');
});
