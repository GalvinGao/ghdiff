import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addConversationAuthors,
  buildConversation,
  filterConversation,
} from './pullConversation.ts';

const person = { login: 'alice', type: 'User' };
const bot = { login: 'coderabbitai[bot]', type: 'Bot' };

describe('buildConversation', () => {
  it('merges both lists into one timeline, oldest first', () => {
    const entries = buildConversation(
      [
        {
          id: 1,
          body: 'second',
          created_at: '2026-09-02T00:00:00Z',
          user: person,
        },
        {
          id: 2,
          body: 'fourth',
          created_at: '2026-09-04T00:00:00Z',
          user: person,
        },
      ],
      [
        {
          id: 1,
          state: 'COMMENTED',
          body: 'first',
          submitted_at: '2026-09-01T00:00:00Z',
          user: person,
        },
        {
          id: 2,
          state: 'APPROVED',
          body: '',
          submitted_at: '2026-09-03T00:00:00Z',
          user: person,
        },
      ]
    );
    assert.deepEqual(
      entries.map((entry) => entry.key),
      ['review-1', 'comment-1', 'review-2', 'comment-2']
    );
  });

  it('keeps a wordless verdict and drops a wordless remark', () => {
    const entries = buildConversation(
      [{ id: 1, body: '   ', user: person }],
      [
        { id: 1, state: 'APPROVED', body: '', user: person },
        { id: 2, state: 'CHANGES_REQUESTED', body: null, user: person },
        { id: 3, state: 'COMMENTED', body: '', user: person },
        { id: 4, state: 'PENDING', body: 'draft', user: person },
        { id: 5, state: 'DISMISSED', body: 'taken back', user: person },
      ]
    );
    assert.deepEqual(
      entries.map((entry) => entry.key),
      ['review-1', 'review-2']
    );
  });

  it('reads a bot from its account type, and survives a deleted account', () => {
    const [first, second] = buildConversation(
      [
        {
          id: 1,
          body: 'summary',
          created_at: '2026-09-01T00:00:00Z',
          user: bot,
        },
        { id: 2, body: 'hi', created_at: '2026-09-02T00:00:00Z', user: null },
      ],
      []
    );
    assert.equal(first?.authorIsBot, true);
    assert.equal(second?.author, 'ghost');
    assert.equal(second?.authorIsBot, false);
  });
});

describe('filterConversation and addConversationAuthors', () => {
  const entries = buildConversation(
    [
      { id: 1, body: 'a', user: person },
      { id: 2, body: 'b', user: bot },
    ],
    [{ id: 1, state: 'APPROVED', user: person }]
  );

  it('narrows to one kind of author', () => {
    assert.equal(filterConversation(entries, 'all').length, 3);
    assert.equal(filterConversation(entries, 'people').length, 2);
    assert.equal(filterConversation(entries, 'bots').length, 1);
  });

  it('adds the conversation to the line threads the bar already counts', () => {
    assert.deepEqual(addConversationAuthors({ people: 4, bots: 1 }, entries), {
      people: 6,
      bots: 2,
    });
  });
});
