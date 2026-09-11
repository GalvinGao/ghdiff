import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  countCommentAuthors,
  filterCommentSections,
  isBotLogin,
  isCommentAuthorFilter,
} from './commentAuthors.ts';
import { commentSection, commentThread } from './commentFixtures.ts';

describe('isBotLogin', () => {
  it('accepts the suffix GitHub reserves for an app', () => {
    assert.equal(isBotLogin('dependabot[bot]'), true);
    assert.equal(isBotLogin('github-actions[bot]'), true);
    assert.equal(isBotLogin('Coderabbitai[BOT]'), true);
  });

  it('rejects a person, and a login that only mentions a bot', () => {
    assert.equal(isBotLogin('GalvinGao'), false);
    assert.equal(isBotLogin('robotics-fan'), false);
    assert.equal(isBotLogin('bot'), false);
    assert.equal(isBotLogin('[bot]-first'), false);
  });
});

describe('isCommentAuthorFilter', () => {
  it('accepts the three filters and nothing else', () => {
    assert.equal(isCommentAuthorFilter('all'), true);
    assert.equal(isCommentAuthorFilter('people'), true);
    assert.equal(isCommentAuthorFilter('bots'), true);
    assert.equal(isCommentAuthorFilter('humans'), false);
    assert.equal(isCommentAuthorFilter(undefined), false);
  });
});

describe('countCommentAuthors', () => {
  it('counts threads across every file', () => {
    const counts = countCommentAuthors([
      commentSection('a.ts', [
        commentThread({ key: '1', author: 'GalvinGao' }),
        commentThread({
          key: '2',
          author: 'dependabot[bot]',
          authorIsBot: true,
        }),
      ]),
      commentSection('b.ts', [
        commentThread({
          key: '3',
          author: 'coderabbitai[bot]',
          authorIsBot: true,
        }),
      ]),
    ]);
    assert.deepEqual(counts, { people: 1, bots: 2 });
  });
});

describe('filterCommentSections', () => {
  const sections = [
    commentSection('a.ts', [
      commentThread({ key: '1', author: 'GalvinGao' }),
      commentThread({ key: '2', author: 'dependabot[bot]', authorIsBot: true }),
    ]),
    commentSection('b.ts', [
      commentThread({
        key: '3',
        author: 'coderabbitai[bot]',
        authorIsBot: true,
      }),
    ]),
  ];

  it('keeps every thread under all', () => {
    const result = filterCommentSections(sections, 'all');
    assert.equal(result.length, 2);
    assert.equal(result[0].threads.length, 2);
  });

  it('drops a file whose every thread the filter removed', () => {
    const result = filterCommentSections(sections, 'people');
    assert.equal(result.length, 1);
    assert.equal(result[0].path, 'a.ts');
    assert.deepEqual(
      result[0].threads.map((entry) => entry.key),
      ['1']
    );
  });

  it('keeps only the bots under bots', () => {
    const result = filterCommentSections(sections, 'bots');
    assert.deepEqual(
      result.flatMap((entry) => entry.threads.map((item) => item.key)),
      ['2', '3']
    );
  });

  it('leaves the sections it was given alone', () => {
    filterCommentSections(sections, 'bots');
    assert.equal(sections[0].threads.length, 2);
  });
});
