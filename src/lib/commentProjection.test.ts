import { parsePatchFiles, type CodeViewDiffItem } from '@pierre/diffs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { projectCommentThreads } from './commentProjection.ts';
import type { CommentMetadata, CommentPayload } from './comments.ts';
import {
  createReviewCommentSession,
  reconcileCommentRead,
} from './reviewCommentSession.ts';

const a = 'a'.repeat(40);
const b = 'b'.repeat(40);
const hunk = '@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n';
const diff = parsePatchFiles(
  `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n${hunk}`,
  'projection'
)[0].files[0];
const items: CodeViewDiffItem<CommentMetadata>[] = [
  { type: 'diff', id: 'a.ts', fileDiff: diff },
];
function comment(changes: Partial<CommentPayload> = {}): CommentPayload {
  return {
    githubId: 1,
    path: 'a.ts',
    author: 'author',
    body: 'Review',
    side: 'additions',
    line: 20,
    originalLine: 2,
    commitSha: b,
    originalCommitSha: a,
    diffHunk: hunk,
    ...changes,
  };
}

describe('historical comment projection', () => {
  it('uses original coordinates only on the original commit', () => {
    const result = projectCommentThreads([comment()], items, a);
    assert.equal(result.located[0]?.thread.comments[0].line, 2);
    assert.equal(
      projectCommentThreads([comment()], items, b).located.length,
      0
    );
  });
  it('keeps replies with their root across page boundaries and changed reply metadata', () => {
    const rows = [
      comment(),
      comment({
        githubId: 2,
        replyToId: 1,
        originalCommitSha: b,
        path: 'renamed.ts',
      }),
    ];
    const result = projectCommentThreads(rows, items, a);
    assert.equal(result.located.length, 1);
    assert.equal(result.located[0].thread.comments.length, 2);
  });
  it('validates LEFT and multi-line ranges against the actual version', () => {
    assert.equal(
      projectCommentThreads([comment({ side: 'deletions' })], items, a).located
        .length,
      1
    );
    assert.equal(
      projectCommentThreads(
        [comment({ originalStartLine: 1, originalLine: 3 })],
        items,
        a
      ).located.length,
      1
    );
    assert.equal(
      projectCommentThreads(
        [comment({ originalStartLine: 1, originalLine: 4 })],
        items,
        a
      ).unplaced.length,
      1
    );
  });
  it('never fabricates line 1 for outdated or mismatching comments', () => {
    for (const row of [
      comment({ originalLine: null }),
      comment({ diffHunk: hunk.replace('+TWO', '+different') }),
      comment({ diffHunk: hunk.replace(' one', ' different context') }),
      comment({ path: 'missing.ts' }),
      comment({ startSide: 'deletions' }),
    ]) {
      const result = projectCommentThreads([row], items, a);
      assert.equal(result.located.length, 0);
      assert.equal(result.unplaced.length, 1);
    }
    assert.equal(
      projectCommentThreads([comment({ line: null })], items).unplaced.length,
      1
    );
  });
  it('recognizes a renamed file by either historical path', () => {
    const renamed = [
      { ...items[0], fileDiff: { ...diff, name: 'new.ts', prevName: 'a.ts' } },
    ];
    assert.equal(
      projectCommentThreads([comment()], renamed, a).located.length,
      1
    );
  });
});

describe('comment sessions', () => {
  it('keeps a completed write when an older list arrives, until GitHub confirms it', () => {
    const session = createReviewCommentSession();
    const local = {
      side: 'additions' as const,
      lineNumber: 2,
      metadata: {
        kind: 'thread' as const,
        key: 'draft-key',
        range: { start: 2, end: 2, side: 'additions' as const },
        localWrite: true,
        comments: [
          { key: 'root', githubId: 1, author: 'author', body: 'Root' },
          { key: 'reply', githubId: 2, author: 'author', body: 'New reply' },
        ],
      },
    };
    session.update((current) => ({
      ...current,
      byItemId: new Map([['a.ts', [local]]]),
    }));
    const older = {
      ...local,
      metadata: {
        ...local.metadata,
        key: 'gh-1',
        localWrite: undefined,
        comments: local.metadata.comments.slice(0, 1),
      },
    };
    session.update((current) =>
      reconcileCommentRead(current, {
        byItemId: new Map([['a.ts', [older]]]),
        unplaced: [],
      })
    );
    assert.deepEqual(session.getSnapshot().byItemId.get('a.ts'), [local]);
    session.update((current) =>
      reconcileCommentRead(current, {
        byItemId: new Map([
          [
            'a.ts',
            [
              {
                ...older,
                metadata: {
                  ...older.metadata,
                  comments: local.metadata.comments,
                },
              },
            ],
          ],
        ]),
        unplaced: [],
      })
    );
    const confirmed = session.getSnapshot().byItemId.get('a.ts')!;
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0].metadata.key, 'draft-key');
    assert.equal(confirmed[0].metadata.localWrite, undefined);
    assert.equal(confirmed[0].metadata.comments?.length, 2);
    session.update((current) =>
      reconcileCommentRead(current, {
        byItemId: new Map(),
        unplaced: [
          {
            key: 'gh-1',
            comments: [comment(), comment({ githubId: 2, replyToId: 1 })],
          },
        ],
      })
    );
    assert.equal(session.getSnapshot().byItemId.size, 0);
    assert.equal(session.getSnapshot().unplaced.length, 1);
  });
  it('keeps a late write and draft text in the version that started it', () => {
    const first = createReviewCommentSession();
    const second = createReviewCommentSession();
    first.drafts.set('draft', 'Unsent text');
    let notifications = 0;
    const unsubscribe = first.subscribe(() => notifications++);
    const lateWrite = () =>
      first.update((current) => ({
        ...current,
        revision: current.revision + 1,
      }));
    unsubscribe();
    lateWrite();
    assert.equal(first.getSnapshot().revision, 1);
    assert.equal(second.getSnapshot().revision, 0);
    assert.equal(notifications, 0);
    assert.equal(first.drafts.get('draft'), 'Unsent text');
    assert.equal(second.drafts.size, 0);
  });
});
