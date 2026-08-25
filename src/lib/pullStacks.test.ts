import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PullSummary } from './pulls.ts';
import { buildPullStacks, countStackNodes } from './pullStacks.ts';

function pull(number: number, headRef: string, baseRef: string): PullSummary {
  return {
    owner: 'acme',
    repo: 'app',
    number,
    title: `Change ${number}`,
    author: 'ada',
    state: 'open',
    htmlUrl: `https://github.com/acme/app/pull/${number}`,
    updatedAt: '2026-08-20T00:00:00Z',
    headRef,
    baseRef,
  };
}

/** Every number in the forest, in the order the list draws them. */
function order(nodes: ReturnType<typeof buildPullStacks>): number[] {
  const result: number[] = [];
  const walk = (items: typeof nodes) => {
    for (const node of items) {
      result.push(node.pull.number);
      walk(node.children);
    }
  };
  walk(nodes);
  return result;
}

describe('buildPullStacks', () => {
  it('makes each unstacked pull request its own single-node stack', () => {
    const stacks = buildPullStacks([
      pull(1, 'a', 'main'),
      pull(2, 'b', 'main'),
    ]);
    assert.equal(stacks.length, 2);
    assert.deepEqual(order(stacks), [2, 1]);
  });

  it('stacks a pull request on the one whose head branch it targets', () => {
    const stacks = buildPullStacks([
      pull(1, 'part-1', 'main'),
      pull(2, 'part-2', 'part-1'),
      pull(3, 'part-3', 'part-2'),
    ]);
    assert.equal(stacks.length, 1);
    assert.deepEqual(order(stacks), [1, 2, 3]);
    assert.equal(countStackNodes(stacks), 3);
  });

  it('holds two branches of one base side by side, newest number first', () => {
    const stacks = buildPullStacks([
      pull(1, 'part-1', 'main'),
      pull(2, 'part-2a', 'part-1'),
      pull(3, 'part-2b', 'part-1'),
    ]);
    assert.equal(stacks.length, 1);
    assert.deepEqual(order(stacks), [1, 3, 2]);
  });

  it('sorts the roots by number, newest first', () => {
    const stacks = buildPullStacks([
      pull(5, 'e', 'main'),
      pull(9, 'f', 'main'),
      pull(7, 'g', 'main'),
    ]);
    assert.deepEqual(order(stacks), [9, 7, 5]);
  });

  it('ignores a pull request that targets its own head branch', () => {
    const stacks = buildPullStacks([pull(1, 'same', 'same')]);
    assert.deepEqual(order(stacks), [1]);
  });

  it('breaks a ring so every pull request is still drawn', () => {
    const stacks = buildPullStacks([pull(1, 'a', 'b'), pull(2, 'b', 'a')]);
    assert.deepEqual(order(stacks).sort(), [1, 2]);
    assert.equal(countStackNodes(stacks), 2);
  });

  it('breaks a longer ring the same way', () => {
    const stacks = buildPullStacks([
      pull(1, 'a', 'c'),
      pull(2, 'b', 'a'),
      pull(3, 'c', 'b'),
    ]);
    assert.equal(countStackNodes(stacks), 3);
  });

  it('returns nothing for nothing', () => {
    assert.deepEqual(buildPullStacks([]), []);
    assert.equal(countStackNodes([]), 0);
  });
});
