import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  describeAge,
  type PullDetailsInput,
  toPullDetails,
} from './pullDetails.ts';

const BASE: PullDetailsInput = {
  number: 12,
  title: 'Add the thing',
  html_url: 'https://github.com/a/b/pull/12',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-02T00:00:00Z',
  user: { login: 'octocat', avatar_url: 'https://example.test/a.png' },
  head: { ref: 'topic' },
  base: { ref: 'main' },
};

describe('toPullDetails', () => {
  it('carries the fields the card shows', () => {
    const details = toPullDetails('a', 'b', {
      ...BASE,
      body: 'Why this change\n',
      additions: 10,
      deletions: 2,
      changed_files: 3,
      commits: 4,
    });
    assert.equal(details.owner, 'a');
    assert.equal(details.repo, 'b');
    assert.equal(details.number, 12);
    assert.equal(details.title, 'Add the thing');
    assert.equal(details.author, 'octocat');
    assert.equal(details.headRef, 'topic');
    assert.equal(details.baseRef, 'main');
    assert.equal(details.body, 'Why this change');
    assert.equal(details.additions, 10);
    assert.equal(details.changedFiles, 3);
  });

  it('drops an empty description rather than reporting one', () => {
    assert.equal(
      toPullDetails('a', 'b', { ...BASE, body: '   ' }).body,
      undefined
    );
    assert.equal(
      toPullDetails('a', 'b', { ...BASE, body: null }).body,
      undefined
    );
    assert.equal(toPullDetails('a', 'b', BASE).body, undefined);
  });

  it('reads the state the way the switcher does', () => {
    assert.equal(toPullDetails('a', 'b', BASE).state, 'open');
    assert.equal(
      toPullDetails('a', 'b', { ...BASE, draft: true }).state,
      'draft'
    );
    assert.equal(
      toPullDetails('a', 'b', { ...BASE, merged_at: '2026-08-03T00:00:00Z' })
        .state,
      'merged'
    );
    assert.equal(
      toPullDetails('a', 'b', { ...BASE, state: 'closed' }).state,
      'closed'
    );
  });

  it('names an unknown author rather than leaving a hole', () => {
    assert.equal(
      toPullDetails('a', 'b', { ...BASE, user: null }).author,
      'unknown'
    );
  });
});

describe('describeAge', () => {
  const now = Date.parse('2026-08-25T12:00:00Z');

  it('picks the unit that reads fastest', () => {
    assert.equal(describeAge('2026-08-25T11:59:30Z', now), 'just now');
    assert.equal(describeAge('2026-08-25T11:55:00Z', now), '5 minutes ago');
    assert.equal(describeAge('2026-08-25T11:00:00Z', now), '1 hour ago');
    assert.equal(describeAge('2026-08-23T12:00:00Z', now), '2 days ago');
    assert.equal(describeAge('2026-08-11T12:00:00Z', now), '2 weeks ago');
    assert.equal(describeAge('2026-06-25T12:00:00Z', now), '2 months ago');
    assert.equal(describeAge('2024-06-25T12:00:00Z', now), '2 years ago');
  });

  it('says nothing when the date cannot be read', () => {
    assert.equal(describeAge('not a date', now), '');
  });
});
