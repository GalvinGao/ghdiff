import type { CodeViewDiffItem, DiffLineAnnotation } from '@pierre/diffs';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { countCommentAuthors } from './commentAuthors';
import type { CommentMetadata } from './comments';
import {
  buildCommentSections,
  buildMergeRequestSection,
} from './commentSections';
import type { ReviewFileEntry } from './reviewData';

function threadAnnotation(
  key: string,
  options: {
    author?: string;
    authorIsBot?: boolean;
    lineNumber?: number;
    replies?: number;
    resolved?: boolean;
    pending?: boolean;
    error?: string;
  } = {}
): DiffLineAnnotation<CommentMetadata> {
  const comments = [
    {
      key: `${key}-root`,
      remoteId: 1,
      author: options.author ?? 'gl',
      authorIsBot: options.authorIsBot,
      body: 'root',
    },
    ...Array.from({ length: options.replies ?? 0 }, (_, index) => ({
      key: `${key}-${index + 2}`,
      remoteId: index + 2,
      author: 'someone-else',
      body: 'reply',
    })),
  ];
  return {
    side: 'additions',
    lineNumber: options.lineNumber ?? 1,
    metadata: {
      kind: 'thread',
      key,
      range: { start: 1, end: 1, side: 'additions', endSide: 'additions' },
      comments,
      ...(options.resolved === true ? { resolved: true } : {}),
      ...(options.pending === true ? { pending: true } : {}),
      ...(options.error == null ? {} : { error: options.error }),
    },
  };
}

const ITEM = {
  id: 'a.ts',
  fileDiff: { hunks: [] },
} as unknown as CodeViewDiffItem<CommentMetadata>;
const ENTRY = { itemId: 'a.ts', path: 'a.ts', fileOrder: 0 } as ReviewFileEntry;

describe('buildCommentSections', () => {
  it('lists resolved threads after the open ones, in line order within each', () => {
    const annotations = [
      threadAnnotation('resolved-early', { lineNumber: 3, resolved: true }),
      threadAnnotation('open-late', { lineNumber: 9 }),
      threadAnnotation('open-early', { lineNumber: 2 }),
      threadAnnotation('resolved-late', { lineNumber: 12, resolved: true }),
    ];
    const sections = buildCommentSections(
      [ITEM],
      new Map([['a.ts', annotations]]),
      [ENTRY]
    );
    assert.deepEqual(
      sections[0]?.threads.map((thread) => thread.key),
      ['open-early', 'open-late', 'resolved-early', 'resolved-late']
    );
    assert.equal(sections[0]?.threads[2].resolved, true);
  });

  it('carries the thread fields and the line the thread is anchored to', () => {
    const sections = buildCommentSections(
      [ITEM],
      new Map([
        [
          'a.ts',
          [
            threadAnnotation('t1', {
              lineNumber: 7,
              replies: 1,
              pending: true,
              error: 'boom',
            }),
          ],
        ],
      ]),
      [ENTRY]
    );
    assert.deepEqual(sections[0]?.threads[0], {
      itemId: 'a.ts',
      path: 'a.ts',
      key: 't1',
      author: 'gl',
      authorAvatarUrl: undefined,
      authorIsBot: false,
      body: 'root',
      replyCount: 1,
      messages: [
        {
          key: 't1-root',
          remoteId: 1,
          author: 'gl',
          authorIsBot: undefined,
          body: 'root',
        },
        {
          key: 't1-2',
          remoteId: 2,
          author: 'someone-else',
          body: 'reply',
        },
      ],
      participants: ['gl', 'someone-else'],
      resolved: undefined,
      staged: undefined,
      lineNumber: 7,
      lineType: 'change',
      side: 'additions',
      range: { start: 1, end: 1, side: 'additions', endSide: 'additions' },
      pending: true,
      error: 'boom',
    });
  });
});

describe('buildMergeRequestSection', () => {
  it('answers nothing when there are no threads', () => {
    assert.equal(buildMergeRequestSection([]), undefined);
  });

  it('maps threads to rows with no line and the root’s own bot flag', () => {
    const section = buildMergeRequestSection([
      threadAnnotation('t1', {
        author: 'project_9_bot_ab12cd',
        authorIsBot: true,
        replies: 2,
        pending: true,
        error: 'boom',
      }),
    ]);
    assert.equal(section?.path, 'Merge request');
    const row = section?.threads[0];
    assert.equal(row?.scope, 'merge-request');
    assert.equal(row?.lineNumber, undefined);
    assert.equal(row?.authorIsBot, true);
    assert.equal(row?.replyCount, 2);
    assert.equal(row?.pending, true);
    assert.equal(row?.error, 'boom');
    assert.deepEqual(row?.participants, [
      'project_9_bot_ab12cd',
      'someone-else',
    ]);
  });

  it('sorts resolved threads after the open ones and counts bots', () => {
    const section = buildMergeRequestSection([
      threadAnnotation('resolved', {
        author: 'project_9_bot_ab12cd',
        authorIsBot: true,
        resolved: true,
      }),
      threadAnnotation('open-bot', {
        author: 'project_9_bot_ab12cd',
        authorIsBot: true,
      }),
      threadAnnotation('open-person', { author: 'gl', authorIsBot: false }),
    ]);
    assert.ok(section != null);
    assert.deepEqual(
      section.threads.map((thread) => thread.key),
      ['open-bot', 'open-person', 'resolved']
    );
    // The People and Bots totals count the merge-request rows too.
    assert.deepEqual(countCommentAuthors([section]), {
      people: 1,
      bots: 2,
    });
  });
});
