import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import type { StagedReviewComment } from './comments';
import { reviewToJsonl } from './reviewExport';

// The JSONL a staged review copies out for an agent: one object per line,
// the review first, and a comment's side stated as the range it names.

const REVIEW = {
  target: 'github.com:octo/hello#7',
  url: 'https://github.com/octo/hello/pull/7',
};

function comment(fields: Partial<StagedReviewComment>): StagedReviewComment {
  return {
    key: 'k1',
    path: 'src/lib/a.ts',
    line: 42,
    side: 'additions',
    body: 'A note.',
    ...fields,
  };
}

function parse(jsonl: string): Record<string, unknown>[] {
  return jsonl
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('reviewToJsonl', () => {
  it('states an additions comment as newRange', () => {
    const [, line] = parse(
      reviewToJsonl({ ...REVIEW, comments: [comment({})] })
    );
    assert.deepEqual(line, {
      type: 'comment',
      path: 'src/lib/a.ts',
      newRange: [42, 42],
      body: 'A note.',
    });
  });

  it('states a deletions comment as oldRange', () => {
    const [, line] = parse(
      reviewToJsonl({
        ...REVIEW,
        comments: [comment({ side: 'deletions' })],
      })
    );
    assert.equal(line.oldRange !== undefined, true);
    assert.equal(line.newRange, undefined);
    assert.deepEqual(line.oldRange, [42, 42]);
  });

  it('ranges a multi-line comment from its start line', () => {
    const [, line] = parse(
      reviewToJsonl({
        ...REVIEW,
        comments: [comment({ line: 45, startLine: 42 })],
      })
    );
    assert.deepEqual(line.newRange, [42, 45]);
  });

  it('carries the note as the summary, trimmed', () => {
    const [review] = parse(
      reviewToJsonl({ ...REVIEW, note: '  Two remarks.  ', comments: [] })
    );
    assert.equal(review.summary, 'Two remarks.');
  });

  it('leaves the summary off an absent or blank note', () => {
    const [absent] = parse(reviewToJsonl({ ...REVIEW, comments: [] }));
    assert.equal(absent.summary, undefined);
    assert.deepEqual(Object.keys(absent), ['type', 'target', 'url']);
    const [blank] = parse(
      reviewToJsonl({ ...REVIEW, note: '   ', comments: [] })
    );
    assert.equal(blank.summary, undefined);
  });

  it('carries the title only when it has one', () => {
    const [withTitle] = parse(
      reviewToJsonl({ ...REVIEW, title: 'Add a thing', comments: [] })
    );
    assert.equal(withTitle.title, 'Add a thing');
    const [without] = parse(reviewToJsonl({ ...REVIEW, comments: [] }));
    assert.equal(without.title, undefined);
  });

  it('stamps the author on every comment when given one', () => {
    const lines = parse(
      reviewToJsonl({
        ...REVIEW,
        author: 'galvin',
        comments: [comment({ key: 'k1' }), comment({ key: 'k2' })],
      })
    );
    assert.equal(lines[1].author, 'galvin');
    assert.equal(lines[2].author, 'galvin');
    // The review line names no author.
    assert.equal(lines[0].author, undefined);
  });

  it('writes one object per line, with no trailing newline', () => {
    const jsonl = reviewToJsonl({
      ...REVIEW,
      comments: [comment({ key: 'k1' }), comment({ key: 'k2' })],
    });
    assert.equal(jsonl.endsWith('\n'), false);
    assert.equal(jsonl.split('\n').length, 3);
    // An empty review is its one line.
    assert.equal(
      reviewToJsonl({ ...REVIEW, comments: [] }).split('\n').length,
      1
    );
  });

  it('matches the agent-context grammar, end to end', () => {
    const jsonl = reviewToJsonl({
      target: 'github.com:owner/repo#123',
      url: 'https://github.com/owner/repo/pull/123',
      title: 'Add a thing',
      note: 'Two remarks.',
      author: 'galvin',
      comments: [
        comment({
          key: 'k1',
          path: 'src/lib/a.ts',
          line: 45,
          startLine: 42,
          body: 'This can be one lookup.',
        }),
        comment({
          key: 'k2',
          path: 'src/lib/b.ts',
          line: 10,
          side: 'deletions',
          body: 'Still needed?',
        }),
      ],
    });
    assert.equal(
      jsonl,
      [
        '{"type":"review","target":"github.com:owner/repo#123","url":"https://github.com/owner/repo/pull/123","title":"Add a thing","summary":"Two remarks."}',
        '{"type":"comment","path":"src/lib/a.ts","newRange":[42,45],"author":"galvin","body":"This can be one lookup."}',
        '{"type":"comment","path":"src/lib/b.ts","oldRange":[10,10],"author":"galvin","body":"Still needed?"}',
      ].join('\n')
    );
  });
});
