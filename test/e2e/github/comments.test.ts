import assert from 'node:assert/strict';
// comments.create / resolve / remove — response state and the forge's own
// state after each call.
import { afterAll, test } from 'vitest';

import {
  rpc,
  ref,
  reviewComments,
  threadIsResolved,
  VIEWER,
  MARK,
  isIsoDate,
  cleanupOwn,
} from './helpers';
import type { CommentPayload } from '@/lib/comments';

afterAll(() => cleanupOwn([1]));

test('comments.create answers with the comment, field by field', async () => {
  const r = await rpc<CommentPayload>('comments/create', {
    ...ref(1),
    path: 'src/styles.css',
    line: 21,
    side: 'additions',
    body: `${MARK} line comment`,
  });
  assert.ok(r.ok, r.raw);
  const c = r.json;
  assert.equal(typeof c.remoteId, 'number');
  assert.equal(c.author, VIEWER.login);
  assert.ok(c.authorAvatarUrl?.startsWith('https://'));
  assert.equal(c.path, 'src/styles.css');
  assert.equal(c.line, 21);
  assert.equal(c.side, 'additions');
  assert.ok(isIsoDate(c.createdAt), `createdAt: ${c.createdAt}`);
  assert.match(c.htmlUrl ?? '', /#discussion_r\d+/);

  const onGitHub = await reviewComments(1);
  assert.ok(
    onGitHub.some((n) => n.id === c.remoteId),
    'not on GitHub'
  );
});

test('a reply links to its thread root, here and on GitHub', async () => {
  const listed = await rpc<CommentPayload[]>('comments/list', ref(1));
  const root = listed.json.find((p) => p.threadId != null);
  assert.ok(root, 'no thread root');
  const r = await rpc<CommentPayload>('comments/create', {
    ...ref(1),
    replyToId: root.remoteId,
    body: `${MARK} reply`,
  });
  assert.ok(r.ok, r.raw);
  assert.equal(r.json.replyToId, root.remoteId);
  assert.equal(r.json.author, VIEWER.login);
  assert.equal(r.json.path, root.path, 'reply inherits the thread path');
  assert.equal(r.json.line, root.line, 'reply inherits the thread line');

  const onGitHub = await reviewComments(1);
  const reply = onGitHub.find((n) => n.id === r.json.remoteId);
  assert.equal(reply?.in_reply_to_id, root.remoteId);
});

test('comments.resolve flips the thread both ways', async () => {
  const listed = await rpc<CommentPayload[]>('comments/list', ref(1));
  const root = listed.json.find((p) => p.threadId != null);
  assert.ok(root, 'no thread root');
  assert.ok(root.threadId != null, 'thread root names no threadId');

  const on = await rpc<{ resolved: boolean }>('comments/resolve', {
    ...ref(1),
    threadId: root.threadId,
    resolved: true,
  });
  assert.ok(on.ok, on.raw);
  assert.equal(on.json.resolved, true);
  assert.equal(
    await threadIsResolved(root.threadId),
    true,
    'GitHub did not resolve'
  );

  const off = await rpc<{ resolved: boolean }>('comments/resolve', {
    ...ref(1),
    threadId: root.threadId,
    resolved: false,
  });
  assert.ok(off.ok, off.raw);
  assert.equal(off.json.resolved, false);
  assert.equal(
    await threadIsResolved(root.threadId),
    false,
    'GitHub did not unresolve'
  );
});

test('comments.remove takes a comment back, here and on GitHub', async () => {
  const created = await rpc<CommentPayload>('comments/create', {
    ...ref(1),
    path: 'src/styles.css',
    line: 21,
    side: 'additions',
    body: `${MARK} short-lived`,
  });
  const id = created.json.remoteId;

  const r = await rpc<{ ok: boolean }>('comments/remove', {
    ...ref(1),
    commentId: id,
  });
  assert.ok(r.ok, r.raw);
  assert.deepEqual(r.json, { ok: true });

  const onGitHub = await reviewComments(1);
  assert.ok(!onGitHub.some((n) => n.id === id), 'still on GitHub');
  const listed = await rpc<CommentPayload[]>('comments/list', ref(1));
  assert.ok(!listed.json.some((p) => p.remoteId === id), 'still listed');
});
