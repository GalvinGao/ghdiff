import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CommentPayload } from './comments.ts';
import { groupCommentThreads, threadComments } from './commentThreads.ts';

function comment(
  githubId: number,
  author: string,
  createdAt: string,
  replyToId?: number
): CommentPayload {
  return {
    githubId,
    path: 'src/index.ts',
    author,
    body: `body ${githubId}`,
    line: 10,
    side: 'additions',
    createdAt,
    replyToId,
  };
}

describe('groupCommentThreads', () => {
  it('keeps a lone comment as a thread of one', () => {
    const threads = groupCommentThreads([comment(1, 'ada', '2026-01-01')]);
    assert.equal(threads.length, 1);
    assert.equal(threads[0].comments.length, 1);
  });

  it('attaches a reply to its root', () => {
    const threads = groupCommentThreads([
      comment(1, 'copilot', '2026-01-01'),
      comment(2, 'galvin', '2026-01-02', 1),
    ]);
    assert.equal(threads.length, 1);
    assert.deepEqual(
      threads[0].comments.map((c) => c.githubId),
      [1, 2]
    );
  });

  it('follows a chained reply back to the root', () => {
    const threads = groupCommentThreads([
      comment(1, 'a', '2026-01-01'),
      comment(2, 'b', '2026-01-02', 1),
      comment(3, 'c', '2026-01-03', 2),
    ]);
    assert.equal(threads.length, 1);
    assert.equal(threads[0].comments.length, 3);
  });

  it('separates two threads on the same line', () => {
    const threads = groupCommentThreads([
      comment(1, 'a', '2026-01-01'),
      comment(2, 'b', '2026-01-02', 1),
      comment(3, 'c', '2026-01-03'),
      comment(4, 'd', '2026-01-04', 3),
    ]);
    assert.equal(threads.length, 2);
    assert.deepEqual(
      threads.map((t) => t.comments.length),
      [2, 2]
    );
  });

  it('puts the root first even when a reply is older', () => {
    const threads = groupCommentThreads([
      comment(2, 'b', '2026-01-01', 1),
      comment(1, 'a', '2026-01-09'),
    ]);
    assert.deepEqual(
      threads[0].comments.map((c) => c.githubId),
      [1, 2]
    );
  });

  it('sorts replies oldest first', () => {
    const threads = groupCommentThreads([
      comment(1, 'a', '2026-01-01'),
      comment(3, 'c', '2026-01-05', 1),
      comment(2, 'b', '2026-01-02', 1),
    ]);
    assert.deepEqual(
      threads[0].comments.map((c) => c.githubId),
      [1, 2, 3]
    );
  });

  it('keeps a reply whose parent is absent, rather than dropping it', () => {
    const threads = groupCommentThreads([comment(9, 'a', '2026-01-01', 404)]);
    assert.equal(threads.length, 1);
    assert.equal(threads[0].comments[0].githubId, 9);
  });

  it('survives a reply that points at itself', () => {
    const threads = groupCommentThreads([comment(1, 'a', '2026-01-01', 1)]);
    assert.equal(threads.length, 1);
  });

  it('survives a cycle between two comments', () => {
    const threads = groupCommentThreads([
      comment(1, 'a', '2026-01-01', 2),
      comment(2, 'b', '2026-01-02', 1),
    ]);
    // It must terminate and account for both comments.
    const total = threads.reduce((sum, t) => sum + t.comments.length, 0);
    assert.equal(total, 2);
  });

  it('groups a browser-only comment with no github id', () => {
    const local: CommentPayload = {
      path: 'a.ts',
      author: 'you',
      body: 'local note',
      line: 3,
      side: 'additions',
    };
    const threads = groupCommentThreads([local, local]);
    assert.equal(
      threads.reduce((s, t) => s + t.comments.length, 0),
      2
    );
  });

  it('groups browser-only rows by the thread they name', () => {
    const root: CommentPayload = {
      path: 'a.ts',
      author: 'you',
      body: 'local note',
      line: 3,
      side: 'additions',
      threadKey: 'local-1',
      createdAt: '2026-01-01',
    };
    const reply: CommentPayload = {
      ...root,
      body: 'and a reply',
      threadKey: 'local-1',
      createdAt: '2026-01-02',
    };
    const other: CommentPayload = {
      ...root,
      body: 'a second thread',
      threadKey: 'local-2',
    };
    const threads = groupCommentThreads([root, reply, other]);
    assert.equal(threads.length, 2);
    assert.deepEqual(
      threads[0].comments.map((c) => c.body),
      ['local note', 'and a reply']
    );
    assert.deepEqual(
      threads[1].comments.map((c) => c.body),
      ['a second thread']
    );
  });

  it('lets a named thread win over the reply chain', () => {
    const threads = groupCommentThreads([
      { ...comment(1, 'ada', '2026-01-01'), threadKey: 'kept' },
      { ...comment(2, 'grace', '2026-01-02', 1), threadKey: 'kept' },
    ]);
    assert.equal(threads.length, 1);
    assert.equal(threads[0].key, 'kept');
  });

  it('handles an empty list', () => {
    assert.deepEqual(groupCommentThreads([]), []);
  });
});

describe('threadComments', () => {
  it('carries author, body, and links across', () => {
    const threads = groupCommentThreads([
      { ...comment(1, 'ada', '2026-01-01'), htmlUrl: 'https://x/1' },
      comment(2, 'grace', '2026-01-02', 1),
    ]);
    const messages = threadComments(threads[0]);
    assert.deepEqual(
      messages.map((m) => m.author),
      ['ada', 'grace']
    );
    assert.equal(messages[0].htmlUrl, 'https://x/1');
    assert.equal(messages[0].githubId, 1);
    // Keys must be unique so React can identify each message.
    assert.equal(new Set(messages.map((m) => m.key)).size, 2);
  });
});
