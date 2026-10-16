import { parsePatchFiles, type SelectedLineRange } from '@pierre/diffs';
import assert from 'node:assert/strict';
import { test } from 'vitest';

import { findLineMarks, rangeTouchesContextLines } from './lineMarks';

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

// The gate's fixture: old lines 1-4, new lines 1-5; the changed lines are
// old 2 and new 2 + 5, everything else is context.
const GATE_PATCH = [
  '@@ -1,4 +1,5 @@',
  ' one',
  '-two',
  '+TWO',
  ' three',
  ' four',
  '+five added',
];

function touchesContext(lines: string[], range: SelectedLineRange) {
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
  return rangeTouchesContextLines(file, range);
}

test('a changed line is not a context line, on either side', () => {
  assert.equal(
    touchesContext(GATE_PATCH, { start: 2, end: 2, side: 'additions' }),
    false
  );
  assert.equal(
    touchesContext(GATE_PATCH, { start: 5, end: 5, side: 'additions' }),
    false
  );
  assert.equal(
    touchesContext(GATE_PATCH, { start: 2, end: 2, side: 'deletions' }),
    false
  );
});

test('a context line blocks, on either side', () => {
  assert.equal(
    touchesContext(GATE_PATCH, { start: 3, end: 3, side: 'additions' }),
    true
  );
  assert.equal(
    touchesContext(GATE_PATCH, { start: 1, end: 1, side: 'deletions' }),
    true
  );
});

test('a range that covers a context line blocks', () => {
  assert.equal(
    touchesContext(GATE_PATCH, { start: 2, end: 5, side: 'additions' }),
    true
  );
  assert.equal(
    touchesContext(GATE_PATCH, { start: 5, end: 5, side: 'additions' }),
    false
  );
});

test('a range across the sides is read by its two ends', () => {
  assert.equal(
    touchesContext(GATE_PATCH, {
      start: 2,
      end: 5,
      side: 'deletions',
      endSide: 'additions',
    }),
    false
  );
  assert.equal(
    touchesContext(GATE_PATCH, {
      start: 1,
      end: 5,
      side: 'deletions',
      endSide: 'additions',
    }),
    true
  );
});
