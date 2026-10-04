import type { DiffLineAnnotation } from '@pierre/diffs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isOnlyInThisTab, mergeGitHubThreads } from './commentMerge.ts';
import type { CommentMetadata, ThreadComment } from './comments.ts';

type Annotation = DiffLineAnnotation<CommentMetadata>;

const RANGE = { start: 3, end: 3, side: 'additions' as const };

function message(githubId: number | undefined, key: string): ThreadComment {
  return { key, githubId, author: 'ada', body: `message ${key}` };
}

function thread(
  key: string,
  comments: ThreadComment[],
  extra: Partial<CommentMetadata> = {}
): Annotation {
  return {
    side: 'additions',
    lineNumber: 3,
    metadata: { kind: 'thread', key, range: RANGE, comments, ...extra },
  };
}

function draft(key: string): Annotation {
  return {
    side: 'additions',
    lineNumber: 3,
    metadata: { kind: 'draft', key, range: RANGE, draftBody: 'half a sen' },
  };
}

function keys(map: ReadonlyMap<string, readonly Annotation[]>, itemId: string) {
  return (map.get(itemId) ?? []).map((annotation) => annotation.metadata.key);
}

describe('isOnlyInThisTab', () => {
  it('is true for what GitHub has not got', () => {
    assert.equal(isOnlyInThisTab(draft('d').metadata), true);
    assert.equal(
      isOnlyInThisTab(
        thread('t', [message(1, 'a')], { pending: true }).metadata
      ),
      true
    );

    assert.equal(
      isOnlyInThisTab(thread('t', [message(undefined, 'a')]).metadata),
      true
    );
  });

  it('is false for a thread GitHub already holds', () => {
    assert.equal(
      isOnlyInThisTab(thread('t', [message(1, 'a')]).metadata),
      false
    );
  });
});

describe('mergeGitHubThreads', () => {
  it('adds a thread another tab posted', () => {
    const merged = mergeGitHubThreads(
      new Map([['f', [thread('github-2', [message(2, 'github-2')])]]]),
      new Map()
    );
    assert.deepEqual(keys(merged, 'f'), ['github-2']);
  });

  it('drops a thread another tab deleted', () => {
    const merged = mergeGitHubThreads(
      new Map(),
      new Map([['f', [thread('draft-1', [message(1, 'gh-1')])]]])
    );
    assert.equal(merged.size, 0);
  });

  it('keeps an open composer', () => {
    const merged = mergeGitHubThreads(
      new Map([['f', [thread('github-2', [message(2, 'github-2')])]]]),
      new Map([['f', [draft('draft-9')]]])
    );
    assert.deepEqual(keys(merged, 'f'), ['github-2', 'draft-9']);
  });

  it('keeps the key this tab drew a thread under, and its messages keys', () => {
    const merged = mergeGitHubThreads(
      new Map([
        [
          'f',
          [
            thread('github-1', [
              message(1, 'github-1'),
              message(5, 'github-5'),
            ]),
          ],
        ],
      ]),
      new Map([['f', [thread('draft-1', [message(1, 'gh-1')])]]])
    );
    const [only] = merged.get('f') ?? [];
    assert.equal(only?.metadata.key, 'draft-1');
    assert.deepEqual(
      only?.metadata.comments?.map((comment) => comment.key),
      ['gh-1', 'github-5']
    );
  });

  it('keeps the issue link GitHub does not know about', () => {
    const issue = {
      number: 7,
      htmlUrl: 'https://github.com/acme/app/issues/7',
    };
    const merged = mergeGitHubThreads(
      new Map([['f', [thread('github-1', [message(1, 'github-1')])]]]),
      new Map([['f', [thread('draft-1', [message(1, 'gh-1')], { issue })]]])
    );
    assert.deepEqual(merged.get('f')?.[0]?.metadata.issue, issue);
  });

  it('prefers this tab’s copy while a reply is on its way', () => {
    const local = thread(
      'draft-1',
      [message(1, 'gh-1'), message(undefined, 'reply-3')],
      { pending: true }
    );
    const merged = mergeGitHubThreads(
      new Map([['f', [thread('github-1', [message(1, 'github-1')])]]]),
      new Map([['f', [local]]])
    );
    assert.deepEqual(merged.get('f'), [local]);
  });

  it('keeps a failed reply when a later reply in the thread succeeded', async () => {
    // The root and the later reply reached GitHub; the earlier reply did not.
    const local = thread(
      'draft-1',
      [message(1, 'gh-1'), message(undefined, 'reply-2'), message(9, 'gh-9')],
      { error: 'GitHub said no' }
    );
    const merged = mergeGitHubThreads(
      new Map([
        [
          'f',
          [
            thread('github-1', [
              message(1, 'github-1'),
              message(9, 'github-9'),
            ]),
          ],
        ],
      ]),
      new Map([['f', [local]]])
    );
    const [only] = merged.get('f') ?? [];
    assert.deepEqual(
      only?.metadata.comments?.map((comment) => comment.key),
      ['gh-1', 'gh-9', 'reply-2']
    );
    assert.equal(only?.metadata.error, 'GitHub said no');
  });

  it('treats a thread GitHub has, with a failed message, as GitHub’s', () => {
    assert.equal(
      isOnlyInThisTab(thread('t', [message(1, 'a')], { error: 'no' }).metadata),
      false
    );
  });

  it('keeps a failed post with the reviewer’s text in it', () => {
    const failed = thread('draft-4', [message(undefined, 'pending-draft-4')], {
      error: 'GitHub said no',
    });
    const merged = mergeGitHubThreads(new Map(), new Map([['g', [failed]]]));
    assert.deepEqual(merged.get('g'), [failed]);
  });
});
