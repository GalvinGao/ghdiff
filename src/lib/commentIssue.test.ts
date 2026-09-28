import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  composeCommentIssue,
  issueCommentBody,
  issueTitleFromText,
  MAX_ISSUE_TITLE_LENGTH,
} from './commentIssue.ts';

const BASE = {
  permalink: 'https://github.com/acme/app/blob/abc/src/a.ts#L3-L5',
  sourceUrl: 'https://github.com/acme/app/pull/7',
  path: 'src/a.ts',
  line: 5,
};

describe('composeCommentIssue', () => {
  it('puts the permalink on a line of its own', () => {
    const { body } = composeCommentIssue({ ...BASE, text: 'Split this up' });
    assert.ok(body.split('\n').includes(BASE.permalink));
  });

  it('keeps the whole text, mentions included, in the body', () => {
    const { body, title } = composeCommentIssue({
      ...BASE,
      text: '@pullfrog fix the cap\nIt drops the last page.',
    });
    assert.equal(title, 'fix the cap');
    assert.ok(
      body.startsWith('@pullfrog fix the cap\nIt drops the last page.')
    );
  });

  it('names the review it came from', () => {
    const { body } = composeCommentIssue({ ...BASE, text: 'x' });
    assert.ok(body.endsWith(BASE.sourceUrl));
  });
});

describe('issueTitleFromText', () => {
  it('falls back to the place when only a mention is left', () => {
    assert.equal(
      issueTitleFromText('@pullfrog', 'src/a.ts', 5),
      'Follow up on src/a.ts line 5'
    );
  });

  it('skips blank leading lines', () => {
    assert.equal(
      issueTitleFromText('\n\n  Rename it  \n', 'a', 1),
      'Rename it'
    );
  });

  it('cuts a long line and says so', () => {
    const title = issueTitleFromText('x'.repeat(200), 'a', 1);
    assert.equal(title.length, MAX_ISSUE_TITLE_LENGTH);
    assert.ok(title.endsWith('…'));
  });

  it('leaves a mention inside the line alone', () => {
    assert.equal(
      issueTitleFromText('Ask @octocat about this', 'a', 1),
      'Ask @octocat about this'
    );
  });
});

describe('issueCommentBody', () => {
  it('is a reference GitHub links both ways', () => {
    assert.equal(issueCommentBody(42), 'see #42');
  });
});
