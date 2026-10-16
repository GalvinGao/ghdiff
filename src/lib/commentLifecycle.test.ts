// The comment lifecycle's decisions — which rows a verdict publishes, when a
// delete is withheld, and what a composer offers — live in the hook and
// component files they serve. The tests sit here because the vitest `lib`
// project runs `src/lib/**/*.test.ts` and nothing else.
import type { DiffLineAnnotation } from '@pierre/diffs';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { composerActions } from '@/components/CommentComposer';
import {
  carryOverComposers,
  draftRowKeys,
  settledStagedThreads,
  threadWritePending,
} from '@/hooks/useReviewComments';
import type { CommentMetadata, CommentPayload } from '@/lib/comments';
import { groupCommentThreads, threadComments } from '@/lib/commentThreads';

type Annotation = DiffLineAnnotation<CommentMetadata>;

function annotation(metadata: CommentMetadata): Annotation {
  return {
    side: metadata.range.endSide ?? metadata.range.side ?? 'additions',
    lineNumber: metadata.range.end,
    metadata,
  };
}

function stagedThread(
  overrides: Partial<CommentMetadata> = {}
): CommentMetadata {
  return {
    kind: 'thread',
    key: 'staged-7',
    range: { start: 4, end: 4, side: 'additions', endSide: 'additions' },
    comments: [
      {
        key: 'staged-7',
        remoteId: 7,
        author: 'reviewer',
        body: 'A staged thought',
      },
    ],
    staged: true,
    ...overrides,
  };
}

const PATHS = new Map([['item-1', 'src/lib/a.ts']]);

describe('settledStagedThreads', () => {
  it('counts a settled draft that carries a remote id', () => {
    const list = settledStagedThreads(
      new Map([['item-1', [annotation(stagedThread())]]]),
      PATHS
    );
    assert.equal(list.length, 1);
    assert.equal(list[0].key, 'staged-7');
    assert.equal(list[0].path, 'src/lib/a.ts');
    assert.equal(list[0].line, 4);
  });

  it('counts a GitHub draft that carries only a node id', () => {
    const thread: CommentMetadata = {
      ...stagedThread(),
      comments: [
        {
          key: 'staged-7',
          remoteNodeId: 'PRRC_1',
          author: 'reviewer',
          body: 'A staged thought',
        },
      ],
    };
    const list = settledStagedThreads(
      new Map([['item-1', [annotation(thread)]]]),
      PATHS
    );
    assert.equal(list.length, 1);
  });

  it('leaves an optimistic write out of the count', () => {
    const list = settledStagedThreads(
      new Map([['item-1', [annotation(stagedThread({ pending: true }))]]]),
      PATHS
    );
    assert.equal(list.length, 0);
  });

  it('leaves a failed write out of the count', () => {
    const list = settledStagedThreads(
      new Map([
        ['item-1', [annotation(stagedThread({ error: 'Could not stage' }))]],
      ]),
      PATHS
    );
    assert.equal(list.length, 0);
  });

  it('leaves a row with no remote identity out of the count', () => {
    const thread: CommentMetadata = {
      ...stagedThread(),
      comments: [
        { key: 'staged-7', author: 'reviewer', body: 'A staged thought' },
      ],
    };
    const list = settledStagedThreads(
      new Map([['item-1', [annotation(thread)]]]),
      PATHS
    );
    assert.equal(list.length, 0);
  });

  it('leaves a posted thread and an open composer out of the count', () => {
    const posted = stagedThread({ staged: false });
    const composer: CommentMetadata = {
      kind: 'draft',
      key: 'draft-1',
      draftBody: 'typing',
      range: { start: 9, end: 9, side: 'additions', endSide: 'additions' },
    };
    const list = settledStagedThreads(
      new Map([['item-1', [annotation(posted), annotation(composer)]]]),
      PATHS
    );
    assert.equal(list.length, 0);
  });
});

describe('a reply staged under a posted thread', () => {
  const root: CommentPayload = {
    remoteId: 3,
    path: 'src/lib/a.ts',
    author: 'maintainer',
    body: 'Posted root',
    line: 4,
    side: 'additions',
  };
  const reply: CommentPayload = {
    remoteId: 5,
    path: 'src/lib/a.ts',
    author: 'reviewer',
    body: 'Staged reply',
    line: 4,
    side: 'additions',
    replyToId: 3,
    staged: true,
  };

  it('keeps its own key, and a draft root names its own thread', () => {
    assert.deepEqual(draftRowKeys(reply, 5), { key: 'remote-5' });
    const draftRoot = { ...reply, replyToId: undefined };
    assert.deepEqual(draftRowKeys(draftRoot, 5), {
      key: 'staged-5',
      threadKey: 'staged-5',
    });
  });

  it('joins the thread it answers, marked as the draft it is', () => {
    const threads = groupCommentThreads([
      root,
      { ...reply, ...draftRowKeys(reply, 5) },
    ]);
    assert.equal(threads.length, 1);
    const comments = threadComments(threads[0]);
    assert.deepEqual(
      comments.map((comment) => comment.staged === true),
      [false, true]
    );
  });

  it('counts as a draft the verdict publishes', () => {
    const posted = stagedThread({
      key: 'gh-3',
      staged: false,
      comments: [
        { key: 'gh-3', remoteId: 3, author: 'maintainer', body: 'Posted root' },
        {
          key: 'gh-5',
          remoteId: 5,
          author: 'reviewer',
          body: 'Staged reply',
          staged: true,
        },
      ],
    });
    const list = settledStagedThreads(
      new Map([['item-1', [annotation(posted)]]]),
      PATHS
    );
    assert.deepEqual(
      list.map((entry) => [entry.key, entry.body]),
      [['gh-5', 'Staged reply']]
    );
  });

  it('still counts while the posted thread has a write of its own', () => {
    const posted = (overrides: Partial<CommentMetadata>) =>
      stagedThread({
        key: 'gh-3',
        staged: false,
        comments: [
          { key: 'gh-3', remoteId: 3, author: 'maintainer', body: 'Root' },
          {
            key: 'gh-5',
            remoteId: 5,
            author: 'reviewer',
            body: 'Staged reply',
            staged: true,
          },
        ],
        ...overrides,
      });
    for (const thread of [
      posted({ error: 'Could not resolve' }),
      posted({ pending: true }),
    ]) {
      const list = settledStagedThreads(
        new Map([['item-1', [annotation(thread)]]]),
        PATHS
      );
      assert.deepEqual(
        list.map((entry) => entry.key),
        ['gh-5']
      );
    }
  });
});

describe('threadWritePending', () => {
  it('withholds Delete while a write is on the wire', () => {
    assert.equal(threadWritePending(stagedThread({ pending: true })), true);
  });

  it('offers Delete again once the write settles', () => {
    assert.equal(threadWritePending(stagedThread({ pending: false })), false);
    assert.equal(threadWritePending(stagedThread()), false);
  });
});

describe('carryOverComposers', () => {
  const composer: CommentMetadata = {
    kind: 'draft',
    key: 'draft-1',
    draftBody: 'half a sentence',
    range: { start: 9, end: 9, side: 'additions', endSide: 'additions' },
  };

  it('keeps an open composer through a re-read', () => {
    const placed = new Map<string, Annotation[]>();
    const current = new Map([['item-1', [annotation(composer)]]]);
    const merged = carryOverComposers(placed, current);
    assert.equal(merged.get('item-1')?.length, 1);
    assert.equal(merged.get('item-1')?.[0].metadata.key, 'draft-1');
  });

  it('never carries a settled thread over a fresh read', () => {
    const placed = new Map<string, Annotation[]>();
    const current = new Map([['item-1', [annotation(stagedThread())]]]);
    const merged = carryOverComposers(placed, current);
    assert.equal(merged.size, 0);
  });

  it('appends the composer after what the read placed on the same file', () => {
    const placed = new Map([['item-1', [annotation(stagedThread())]]]);
    const current = new Map([['item-1', [annotation(composer)]]]);
    const merged = carryOverComposers(placed, current);
    const keys = merged.get('item-1')?.map((a) => a.metadata.key);
    assert.deepEqual(keys, ['staged-7', 'draft-1']);
  });
});

describe('composerActions', () => {
  it('saves a browser-only comment and says where it lives', () => {
    const actions = composerActions({
      store: 'local',
      canStage: false,
      draftsExist: false,
      stageNeedsSignIn: false,
    });
    assert.equal(actions.primaryLabel, 'Save comment');
    assert.equal(actions.joinsDraft, false);
    assert.equal(actions.stageOffered, false);
    assert.match(actions.stageDisabledReason ?? '', /pull request/);
    assert.match(actions.localHint ?? '', /this browser/);
  });

  it('joins an existing draft review on a pull target', () => {
    const actions = composerActions({
      store: 'forge',
      canStage: true,
      draftsExist: true,
      stageNeedsSignIn: false,
    });
    assert.equal(actions.joinsDraft, true);
    assert.equal(actions.primaryLabel, 'Add review suggestion');
    assert.equal(actions.stageOffered, false);
    assert.equal(actions.stageDisabledReason, undefined);
  });

  it('offers the outline suggestion before a draft review exists', () => {
    const actions = composerActions({
      store: 'forge',
      canStage: true,
      draftsExist: false,
      stageNeedsSignIn: false,
    });
    assert.equal(actions.primaryLabel, 'Comment');
    assert.equal(actions.stageOffered, true);
    assert.equal(actions.stageDisabledReason, undefined);
  });

  it('asks for a sign-in when the pull target has no credential', () => {
    const actions = composerActions({
      store: 'forge',
      canStage: false,
      draftsExist: false,
      stageNeedsSignIn: true,
    });
    assert.equal(actions.stageOffered, false);
    assert.match(actions.stageDisabledReason ?? '', /Sign in/);
  });
});
