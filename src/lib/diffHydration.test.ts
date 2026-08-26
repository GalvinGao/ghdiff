import { parsePatchFiles } from '@pierre/diffs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  oldFileFromPatch,
  patchFitsNewFile,
  splitFileLines,
} from './diffHydration.ts';

// Every patch below came out of `git diff --no-index -U3`, so what is under
// test is the reverse-apply against git's own arithmetic rather than against a
// patch written to suit it.

/** `count` lines of `line 1`, `line 2`, ... each with its own newline. */
function numbered(count: number): string {
  let text = '';
  for (let number = 1; number <= count; number++) text += `line ${number}\n`;
  return text;
}

function fileDiffFrom(patch: string) {
  const file = parsePatchFiles(patch, 'test')[0]?.files[0];
  assert.ok(file != null, 'the patch parsed to a file diff');
  assert.equal(file.isPartial, true);
  return file;
}

function rebuild(patch: string, newFile: string): string {
  const fileDiff = fileDiffFrom(patch);
  const newLines = splitFileLines(newFile);
  assert.equal(patchFitsNewFile(fileDiff, newLines), true);
  return oldFileFromPatch(fileDiff, newLines);
}

const HEADER = [
  'diff --git a/f.txt b/f.txt',
  'index 1111111..2222222 100644',
  '--- a/f.txt',
  '+++ b/f.txt',
];

function patchOf(...body: string[]): string {
  return [...HEADER, ...body, ''].join('\n');
}

test('rebuilds the old file across two hunks and the gap between them', () => {
  const oldFile = numbered(40);
  const newFile = oldFile
    .replace('line 5\n', 'LINE 5\nLINE 5b\n')
    .replace('line 33\n', '');
  const patch = patchOf(
    '@@ -2,7 +2,8 @@ line 1',
    ' line 2',
    ' line 3',
    ' line 4',
    '-line 5',
    '+LINE 5',
    '+LINE 5b',
    ' line 6',
    ' line 7',
    ' line 8',
    '@@ -30,7 +31,6 @@ line 29',
    ' line 30',
    ' line 31',
    ' line 32',
    '-line 33',
    ' line 34',
    ' line 35',
    ' line 36'
  );

  assert.equal(rebuild(patch, newFile), oldFile);
});

test('rebuilds a file whose first line changed', () => {
  const oldFile = numbered(20);
  const newFile = `FIRST\n${oldFile.slice('line 1\n'.length)}`;
  const patch = patchOf(
    '@@ -1,4 +1,4 @@',
    '-line 1',
    '+FIRST',
    ' line 2',
    ' line 3',
    ' line 4'
  );

  assert.equal(rebuild(patch, newFile), oldFile);
});

test('rebuilds a file whose new side lost its last newline', () => {
  const oldFile = numbered(20);
  const newFile = `${oldFile.slice(0, -'line 20\n'.length)}LAST`;
  const patch = patchOf(
    '@@ -17,4 +17,4 @@ line 16',
    ' line 17',
    ' line 18',
    ' line 19',
    '-line 20',
    '+LAST',
    '\\ No newline at end of file'
  );

  assert.equal(rebuild(patch, newFile), oldFile);
});

test('rebuilds a file the change emptied', () => {
  const oldFile = numbered(6);
  const patch = patchOf(
    '@@ -1,6 +0,0 @@',
    '-line 1',
    '-line 2',
    '-line 3',
    '-line 4',
    '-line 5',
    '-line 6'
  );

  assert.equal(rebuild(patch, ''), oldFile);
});

test('keeps each side of a CRLF file on its own line breaks', () => {
  const oldFile = numbered(12).replaceAll('\n', '\r\n');
  const newFile = oldFile.replace('line 6\r\n', 'LINE 6\r\n');
  const patch = patchOf(
    '@@ -3,7 +3,7 @@ line 2',
    ' line 3\r',
    ' line 4\r',
    ' line 5\r',
    '-line 6\r',
    '+LINE 6\r',
    ' line 7\r',
    ' line 8\r',
    ' line 9\r'
  );

  assert.equal(rebuild(patch, newFile), oldFile);
});

test('refuses a file that has moved on since the patch', () => {
  const patch = patchOf(
    '@@ -2,7 +2,8 @@ line 1',
    ' line 2',
    ' line 3',
    ' line 4',
    '-line 5',
    '+LINE 5',
    '+LINE 5b',
    ' line 6',
    ' line 7',
    ' line 8'
  );
  const fileDiff = fileDiffFrom(patch);

  // The addition landed, and then somebody edited the line under it.
  const moved = numbered(40)
    .replace('line 5\n', 'LINE 5\nLINE 5b\n')
    .replace('line 7\n', 'line 7 edited\n');
  assert.equal(patchFitsNewFile(fileDiff, splitFileLines(moved)), false);

  // A file too short to hold the hunk at all.
  assert.equal(patchFitsNewFile(fileDiff, splitFileLines(numbered(4))), false);
});

test('splits lines with their own newline, and empty text into nothing', () => {
  assert.deepEqual(splitFileLines('a\nb\n'), ['a\n', 'b\n']);
  assert.deepEqual(splitFileLines('a\nb'), ['a\n', 'b']);
  assert.deepEqual(splitFileLines(''), []);
});
