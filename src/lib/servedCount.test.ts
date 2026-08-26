import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatServedCount, parseServedCount } from './servedCount.ts';

test('reads a stored count', () => {
  assert.equal(parseServedCount('0'), 0);
  assert.equal(parseServedCount('1'), 1);
  assert.equal(parseServedCount('12345'), 12345);
  assert.equal(parseServedCount(' 42 '), 42);
});

test('an absent key counts nothing', () => {
  assert.equal(parseServedCount(null), 0);
  assert.equal(parseServedCount(''), 0);
});

test('a body that is not a count reads as none', () => {
  assert.equal(parseServedCount('many'), 0);
  assert.equal(parseServedCount('Infinity'), 0);
  assert.equal(parseServedCount('-7'), 0);
});

test('a fraction rounds down to whole diffs', () => {
  assert.equal(parseServedCount('3.9'), 3);
});

test('groups the figure in thousands', () => {
  assert.equal(formatServedCount(7), '7');
  assert.equal(formatServedCount(1234), '1,234');
  assert.equal(formatServedCount(1048576), '1,048,576');
});
