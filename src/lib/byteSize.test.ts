import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatBytes } from './byteSize.ts';

test('counts bytes up to the first thousand', () => {
  assert.equal(formatBytes(0), '0 bytes');
  assert.equal(formatBytes(1), '1 bytes');
  assert.equal(formatBytes(999), '999 bytes');
});

test('counts whole kB below the first million', () => {
  assert.equal(formatBytes(1000), '1 kB');
  assert.equal(formatBytes(84_600), '85 kB');
  assert.equal(formatBytes(999_400), '999 kB');
});

test('counts MB to one decimal place above it', () => {
  assert.equal(formatBytes(1_000_000), '1.0 MB');
  assert.equal(formatBytes(18_240_000), '18.2 MB');
  assert.equal(formatBytes(43_000_000), '43.0 MB');
});

test('answers for a figure that is not one', () => {
  assert.equal(formatBytes(-1), '0 bytes');
  assert.equal(formatBytes(Number.NaN), '0 bytes');
  assert.equal(formatBytes(Number.POSITIVE_INFINITY), '0 bytes');
});
