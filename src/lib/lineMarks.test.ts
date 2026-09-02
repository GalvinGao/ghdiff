import { parsePatchFiles } from '@pierre/diffs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findLineMarks } from './lineMarks.ts';

// Every patch below is written the way git writes one, and parsed by the same
// `parsePatchFiles` the app itself feeds, so the line numbers under test are
// the numbers the gutter will show.

function marksFrom(lines: string[]) {
  const patch = [
    'diff --git a/f.txt b/f.txt',
    'index 1111111..2222222 100644',
    '--- a/f.txt',
    '+++ b/f.txt',
    ...lines,
    '',
  ].join('\n');
  const file = parsePatchFiles(patch, 'test')[0]?.files[0];
  assert.ok(file != null, 'the patch parsed to a file diff');
  return findLineMarks(file);
}

function sorted(set: Set<number> | undefined): number[] {
  return [...(set ?? [])].sort((a, b) => a - b);
}

test('a re-indented block is quiet on both sides', () => {
  const marks = marksFrom([
    '@@ -1,4 +1,4 @@',
    ' start',
    '-value = 1',
    '-print(value)',
    '+    value = 1',
    '+    print(value)',
    ' end',
  ]);
  assert.ok(marks != null);
  assert.deepEqual(sorted(marks.quietDeletions), [2, 3]);
  assert.deepEqual(sorted(marks.quietAdditions), [2, 3]);
  assert.equal(marks.movedDeletions.size, 0);
});

test('tabs against spaces and stripped trailing whitespace are quiet', () => {
  const marks = marksFrom([
    '@@ -1,3 +1,3 @@',
    '-\tindented()',
    '-trailing()   ',
    '+        indented()',
    '+trailing()',
    ' end',
  ]);
  assert.ok(marks != null);
  assert.deepEqual(sorted(marks.quietDeletions), [1, 2]);
  assert.deepEqual(sorted(marks.quietAdditions), [1, 2]);
});

test('a changed line is not quiet', () => {
  const marks = marksFrom([
    '@@ -1,2 +1,2 @@',
    '-total = a + b',
    '+total = a - b',
    ' end',
  ]);
  assert.equal(marks, undefined);
});

test('extra lines in an uneven block are never quiet', () => {
  const marks = marksFrom([
    '@@ -1,2 +1,3 @@',
    '-  keep()',
    '+keep()',
    '+added()',
    ' end',
  ]);
  assert.ok(marks != null);
  assert.deepEqual(sorted(marks.quietDeletions), [1]);
  assert.deepEqual(sorted(marks.quietAdditions), [1]);
});

test('whitespace inside a string is quiet by design', () => {
  // `git diff -w` makes the same call. The dim keeps the line readable and
  // the intraline highlight still lands on the exact characters.
  const marks = marksFrom([
    '@@ -1,2 +1,2 @@',
    "-say('a b')",
    "+say('ab')",
    ' end',
  ]);
  assert.ok(marks != null);
  assert.deepEqual(sorted(marks.quietAdditions), [1]);
});

test('a block that reappears further down is a move on both sides', () => {
  const marks = marksFrom([
    '@@ -1,5 +1,1 @@',
    '-def helper(x):',
    '-    y = x * 2',
    '-    return y + 1',
    '-',
    ' top',
    '@@ -20,2 +16,6 @@',
    ' middle',
    '+def helper(x):',
    '+    y = x * 2',
    '+    return y + 1',
    '+',
    ' bottom',
  ]);
  assert.ok(marks != null);
  // The trailing blank line travelled with the block, so it is part of it.
  assert.deepEqual(sorted(marks.movedDeletions), [1, 2, 3, 4]);
  assert.deepEqual(sorted(marks.movedAdditions), [17, 18, 19, 20]);
  assert.equal(marks.quietDeletions.size, 0);
});

test('a moved block keeps matching after a re-indent', () => {
  const marks = marksFrom([
    '@@ -1,4 +1,1 @@',
    '-alpha(1)',
    '-beta(22)',
    '-gamma(333)',
    ' top',
    '@@ -20,2 +17,5 @@',
    ' middle',
    '+    alpha(1)',
    '+    beta(22)',
    '+    gamma(333)',
    ' bottom',
  ]);
  assert.ok(marks != null);
  assert.deepEqual(sorted(marks.movedDeletions), [1, 2, 3]);
  assert.deepEqual(sorted(marks.movedAdditions), [18, 19, 20]);
});

test('two matching lines are not a move', () => {
  const marks = marksFrom([
    '@@ -1,3 +1,1 @@',
    '-alpha(111)',
    '-beta(2222)',
    ' top',
    '@@ -20,2 +18,4 @@',
    ' middle',
    '+alpha(111)',
    '+beta(2222)',
    ' bottom',
  ]);
  assert.equal(marks, undefined);
});

test('three near-empty lines are not a move', () => {
  const marks = marksFrom([
    '@@ -1,4 +1,1 @@',
    '-}',
    '-)',
    '-]',
    ' top',
    '@@ -20,2 +17,5 @@',
    ' middle',
    '+}',
    '+)',
    '+]',
    ' bottom',
  ]);
  assert.equal(marks, undefined);
});

test('a block must be contiguous on both sides to move', () => {
  // The same three lines reappear, but split across two places: the gap on
  // the addition side breaks the block, and no single run reaches three
  // lines.
  const marks = marksFrom([
    '@@ -1,4 +1,1 @@',
    '-alpha(1)',
    '-beta(22)',
    '-gamma(333)',
    ' top',
    '@@ -20,3 +17,6 @@',
    ' middle',
    '+alpha(1)',
    '+beta(22)',
    ' gap',
    '+gamma(333)',
    ' bottom',
  ]);
  assert.equal(marks, undefined);
});

test('a quiet pair is never also a move', () => {
  // Line 1 pairs with its own re-indent, so the identical block added at the
  // foot must not claim it.
  const marks = marksFrom([
    '@@ -1,3 +1,3 @@',
    '-first_line(1)',
    '+    first_line(1)',
    ' top',
    '@@ -20,2 +20,5 @@',
    ' middle',
    '+first_line(1)',
    '+second_line(22)',
    '+third_line(333)',
    ' bottom',
  ]);
  assert.ok(marks != null);
  assert.deepEqual(sorted(marks.quietDeletions), [1]);
  assert.equal(marks.movedDeletions.size, 0);
  assert.equal(marks.movedAdditions.size, 0);
});
