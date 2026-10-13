import assert from 'node:assert/strict';
// drafts.create / list / remove — the forge's own staging area.
import { afterAll, test } from 'vitest';

import { rpc, ref, draftNotes, VIEWER, MARK, cleanupOwn } from './helpers';
import type { CommentPayload } from '@/lib/comments';

afterAll(() => cleanupOwn([1]));

test('drafts.create stages a draft note and echoes its position', async () => {
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
  assert.equal(d.path, 'src/utils.ts');
  assert.equal(d.line, 17);
  assert.equal(d.side, 'additions');

  const drafts = await draftNotes(1);
  assert.ok(
    drafts.some((n) => n.id === d.remoteId && n.note === `${MARK} draft`),
    'not a GitLab draft note'
  );
});

test('drafts.create answers with the staging author', async () => {
  const r = await rpc<CommentPayload>('drafts/create', {
    ...ref(1),
    path: 'src/utils.ts',
    line: 17,
    side: 'additions',
    body: `${MARK} author check`,
  });
  assert.ok(r.ok, r.raw);
  assert.equal(r.json.author, VIEWER.username);
  assert.ok(r.json.authorAvatarUrl?.startsWith('https://'));
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
  assert.equal(d.author, VIEWER.username);
  assert.ok(d.authorAvatarUrl?.startsWith('https://'));
});

test('drafts.remove takes a draft back, here and on GitLab', async () => {
  const created = await rpc<CommentPayload>('drafts/create', {
    ...ref(1),
    path: 'src/utils.ts',
    line: 17,
    side: 'additions',
    body: `${MARK} short-lived`,
  });
  const id = created.json.remoteId;

  const r = await rpc<{ ok: boolean }>('drafts/remove', { ...ref(1), id });
  assert.ok(r.ok, r.raw);
  assert.deepEqual(r.json, { ok: true });

  const drafts = await draftNotes(1);
  assert.ok(!drafts.some((n) => n.id === id), 'still a GitLab draft note');
  const listed = await rpc<{ drafts: CommentPayload[] }>('drafts/list', ref(1));
  assert.ok(!listed.json.drafts.some((d) => d.remoteId === id), 'still listed');
});
