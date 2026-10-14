import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ReviewParseCache } from './reviewParseCache.ts';

const patch =
  'diff --git a/f.ts b/f.ts\nnew file mode 100644\n--- /dev/null\n+++ b/f.ts\n@@ -0,0 +1 @@\n+new\n';

test('reuses a fresh response and its hydrated metadata on a revisit', () => {
  const cache = new ReviewParseCache();
  const response = { body: patch };
  const first = cache.get(response, 'same-target');
  first.items[0].fileDiff.isPartial = false;
  assert.equal(cache.get(response, 'same-target'), first);
  assert.equal(
    cache.get(response, 'same-target').items[0].fileDiff.isPartial,
    false
  );
});

test('response replacement, changed body and target keys require a new parse', () => {
  const cache = new ReviewParseCache();
  const response = { body: patch };
  const first = cache.get(response, 'first');
  assert.notEqual(cache.get({ body: patch }, 'first'), first);
  const otherTarget = cache.get(response, 'other');
  assert.notEqual(otherTarget, first);
  assert.notEqual(
    otherTarget.items[0].fileDiff.cacheKey,
    first.items[0].fileDiff.cacheKey
  );
  response.body = patch.replace('+new\n', '+changed\n');
  const changed = cache.get(response, 'other');
  assert.notEqual(changed, otherTarget);
  assert.equal(changed.items[0].fileDiff.additionLines[0], 'changed\n');
});

test('untracked membership and cache ownership stay separate', () => {
  const cache = new ReviewParseCache();
  const response = { body: patch };
  const tracked = cache.get(response, 'local');
  const paths = new Set(['f.ts']);
  const untracked = cache.get(response, 'local', paths);
  assert.equal(tracked.entries[0].status, 'added');
  assert.equal(untracked.entries[0].status, 'untracked');
  assert.equal(cache.get(response, 'local', paths), untracked);
  assert.notEqual(
    new ReviewParseCache().get(response, 'local', paths),
    untracked
  );
});

test('retains at most three parses and a revisit refreshes recency', () => {
  const cache = new ReviewParseCache();
  const responses = Array.from({ length: 4 }, () => ({ body: patch }));
  const first = cache.get(responses[0], 'target');
  const second = cache.get(responses[1], 'target');
  const third = cache.get(responses[2], 'target');
  assert.equal(cache.get(responses[0], 'target'), first);
  cache.get(responses[3], 'target');
  assert.equal(cache.get(responses[2], 'target'), third);
  assert.notEqual(cache.get(responses[1], 'target'), second);
});
