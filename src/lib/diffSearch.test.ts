import { parsePatchFiles } from '@pierre/diffs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  indexMatchesByLine,
  nearestMatchIndex,
  type SearchableItem,
  type SearchMatch,
  searchDiff,
} from './diffSearch.ts';

// Every patch below is written the way git writes one, and parsed by the same
// `parsePatchFiles` the app itself feeds, so the line numbers under test are
// the numbers the gutter will show.

function fileItem(id: string, lines: string[]): SearchableItem {
  const patch = [
    `diff --git a/${id} b/${id}`,
    'index 1111111..2222222 100644',
    `--- a/${id}`,
    `+++ b/${id}`,
    ...lines,
    '',
  ].join('\n');
  const file = parsePatchFiles(patch, 'test')[0]?.files[0];
  assert.ok(file != null, 'the patch parsed to a file diff');
  return { id, fileDiff: file };
}

const UNIFIED = { diffStyle: 'unified' } as const;
const SPLIT = { diffStyle: 'split' } as const;

const ONE_FILE = fileItem('f.txt', [
  '@@ -10,4 +10,5 @@',
  ' alpha beta',
  '-Beta gone',
  '+beta here',
  '+BETA again beta',
  ' omega',
]);

function shape(match: SearchMatch) {
  return [match.side, match.lineNumber, match.start, match.end] as const;
}

describe('searchDiff', () => {
  it('finds nothing for an empty query', () => {
    const result = searchDiff([ONE_FILE], '', UNIFIED);
    assert.equal(result.matches.length, 0);
    assert.equal(result.truncated, false);
  });

  it('reads a unified view in the order it prints', () => {
    const { matches } = searchDiff([ONE_FILE], 'beta', UNIFIED);
    assert.deepEqual(matches.map(shape), [
      // The context line, once, with its new-side number.
      ['additions', 10, 6, 10],
      // Inside the change block: the deletion, then the additions.
      ['deletions', 11, 0, 4],
      ['additions', 11, 0, 4],
      ['additions', 12, 0, 4],
      ['additions', 12, 11, 15],
    ]);
    assert.ok(matches.every((match) => match.itemId === 'f.txt'));
  });

  it('reads a split view row by row, left before right', () => {
    const { matches } = searchDiff([ONE_FILE], 'beta', SPLIT);
    assert.deepEqual(matches.map(shape), [
      // The context line is drawn on both sides, so it is two places: the old
      // number on the left, the new one on the right.
      ['deletions', 10, 6, 10],
      ['additions', 10, 6, 10],
      // The change block pairs its lines by row: the one deletion sits beside
      // the first addition, and the second addition has the row to itself.
      ['deletions', 11, 0, 4],
      ['additions', 11, 0, 4],
      ['additions', 12, 0, 4],
      ['additions', 12, 11, 15],
    ]);
  });

  it('numbers a context line by the side it is on', () => {
    const item = fileItem('c.txt', [
      '@@ -100,3 +200,3 @@',
      ' one',
      '-two',
      '+deux',
      ' three',
    ]);
    assert.deepEqual(searchDiff([item], 'three', UNIFIED).matches.map(shape), [
      ['additions', 202, 0, 5],
    ]);
    assert.deepEqual(searchDiff([item], 'three', SPLIT).matches.map(shape), [
      ['deletions', 102, 0, 5],
      ['additions', 202, 0, 5],
    ]);
  });

  it('ignores case, the way the browser does', () => {
    const lower = searchDiff([ONE_FILE], 'beta', UNIFIED).matches.length;
    const upper = searchDiff([ONE_FILE], 'BETA', UNIFIED).matches.length;
    assert.equal(lower, 5);
    assert.equal(upper, lower);
  });

  it('takes the query literally', () => {
    const item = fileItem('r.txt', ['@@ -1,2 +1,2 @@', ' a.b', '-axb', '+a[b']);
    assert.deepEqual(searchDiff([item], 'a.b', UNIFIED).matches.map(shape), [
      ['additions', 1, 0, 3],
    ]);
    assert.deepEqual(searchDiff([item], 'a[b', UNIFIED).matches.map(shape), [
      ['additions', 2, 0, 3],
    ]);
  });

  it('numbers a deleted line on the old side', () => {
    const item = fileItem('d.txt', [
      '@@ -100,3 +200,2 @@',
      ' keep',
      '-drop this',
      ' keep',
    ]);
    assert.deepEqual(searchDiff([item], 'drop', UNIFIED).matches.map(shape), [
      ['deletions', 101, 0, 4],
    ]);
  });

  it('lists files in the order they were given', () => {
    const first = fileItem('a.txt', ['@@ -1 +1 @@', '-x', '+needle']);
    const second = fileItem('b.txt', ['@@ -1 +1 @@', '-needle', '+y']);
    const { matches } = searchDiff([second, first], 'needle', UNIFIED);
    assert.deepEqual(
      matches.map((match) => match.itemId),
      ['b.txt', 'a.txt']
    );
  });

  it('stops at the cap and says so', () => {
    const result = searchDiff([ONE_FILE], 'beta', { ...UNIFIED, limit: 3 });
    assert.equal(result.matches.length, 3);
    assert.equal(result.truncated, true);
    const whole = searchDiff([ONE_FILE], 'beta', { ...UNIFIED, limit: 5 });
    assert.equal(whole.matches.length, 5);
    assert.equal(whole.truncated, false);
    const split = searchDiff([ONE_FILE], 'beta', { ...SPLIT, limit: 1 });
    assert.deepEqual(split.matches.map(shape), [['deletions', 10, 6, 10]]);
    assert.equal(split.truncated, true);
  });

  it('caps inside one line, and says so', () => {
    const item = fileItem('m.txt', ['@@ -1 +1 @@', '-x', `+${'a'.repeat(50)}`]);
    const capped = searchDiff([item], 'a', { ...UNIFIED, limit: 3 });
    assert.equal(capped.matches.length, 3);
    assert.equal(capped.truncated, true);
    const whole = searchDiff([item], 'a', { ...UNIFIED, limit: 50 });
    assert.equal(whole.matches.length, 50);
    assert.equal(whole.truncated, false);
  });
});

describe('nearestMatchIndex', () => {
  const files = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const matches: SearchMatch[] = [
    { itemId: 'a', side: 'additions', lineNumber: 1, start: 0, end: 1 },
    { itemId: 'b', side: 'additions', lineNumber: 1, start: 0, end: 1 },
    { itemId: 'd', side: 'additions', lineNumber: 1, start: 0, end: 1 },
  ];

  it('starts in the file the reviewer is reading', () => {
    assert.equal(nearestMatchIndex(matches, files, 'b'), 1);
  });

  it('starts in the next file when the current one has none', () => {
    assert.equal(nearestMatchIndex(matches, files, 'c'), 2);
  });

  it('starts at the top with no file, an unknown file, or nothing after', () => {
    assert.equal(nearestMatchIndex(matches, files, undefined), 0);
    assert.equal(nearestMatchIndex(matches, files, 'zzz'), 0);
    const early = matches.slice(0, 2);
    assert.equal(nearestMatchIndex(early, files, 'd'), 0);
  });

  it('answers -1 for no matches', () => {
    assert.equal(nearestMatchIndex([], files, 'a'), -1);
  });
});

describe('indexMatchesByLine', () => {
  it('groups by file, side and line, and keeps each match ordinal', () => {
    const { matches } = searchDiff([ONE_FILE], 'beta', SPLIT);
    const index = indexMatchesByLine(matches);
    const file = index.get('f.txt');
    assert.ok(file != null);
    // The context line, under each side it is drawn on.
    assert.deepEqual(file.deletions.get(10), [
      { start: 6, end: 10, ordinal: 0 },
    ]);
    assert.deepEqual(file.additions.get(10), [
      { start: 6, end: 10, ordinal: 1 },
    ]);
    assert.deepEqual(file.additions.get(12), [
      { start: 0, end: 4, ordinal: 4 },
      { start: 11, end: 15, ordinal: 5 },
    ]);
    assert.deepEqual(file.deletions.get(11), [
      { start: 0, end: 4, ordinal: 2 },
    ]);
    assert.equal(file.deletions.get(12), undefined);
  });
});
