import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isFileViewed } from './viewedFiles.ts';

test('only VIEWED counts as read', () => {
  assert.equal(isFileViewed('VIEWED'), true);
  assert.equal(isFileViewed('UNVIEWED'), false);
});

test('a file that changed after the mark counts as unread', () => {
  assert.equal(isFileViewed('DISMISSED'), false);
});

test('a missing state counts as unread', () => {
  assert.equal(isFileViewed(undefined), false);
  assert.equal(isFileViewed(null), false);
  assert.equal(isFileViewed(''), false);
});
