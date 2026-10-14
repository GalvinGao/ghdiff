import assert from 'node:assert/strict';
import { test } from 'node:test';

import { activeDiffItemAt } from './activeDiffItem.ts';

test('tracks top, middle, tail, boundaries and equal file tops', () => {
  const ids = ['first', 'second', 'empty', 'last'];
  const tops = new Map([
    ['first', 30],
    ['second', 100],
    ['empty', 100],
    ['last', 200],
  ]);
  const viewer = { getTopForItem: (id: string) => tops.get(id) };
  for (const [anchor, expected] of [
    [0, undefined],
    [30, 'first'],
    [99, 'first'],
    [100, 'empty'],
    [199, 'empty'],
    [200, 'last'],
    [999, 'last'],
  ] as const) {
    assert.equal(activeDiffItemAt(ids, anchor, viewer), expected);
  }
  assert.equal(activeDiffItemAt([], 100, viewer), undefined);
});

test('needs at most twelve geometry lookups at the tail of 3,000 files', () => {
  const ids = Array.from({ length: 3000 }, (_, i) => String(i));
  let calls = 0;
  const viewer = {
    getTopForItem(id: string) {
      calls++;
      return Number(id) * 100;
    },
  };
  assert.equal(activeDiffItemAt(ids, 299900, viewer), '2999');
  assert.ok(calls <= 12, `${calls} lookups`);
});

test('keeps skip-missing behavior while the viewer updates its item list', () => {
  const ids = ['first', 'removed', 'last'];
  const tops = new Map([
    ['first', 10],
    ['last', 100],
  ]);
  const viewer = { getTopForItem: (id: string) => tops.get(id) };
  assert.equal(activeDiffItemAt(ids, 50, viewer), 'first');
  assert.equal(activeDiffItemAt(ids, 100, viewer), 'last');
  assert.equal(
    activeDiffItemAt(ids, 100, { getTopForItem: () => undefined }),
    undefined
  );
});
