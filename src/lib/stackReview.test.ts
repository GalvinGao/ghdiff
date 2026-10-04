import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PullSummary } from './pulls.ts';
import type { GitHubPullTarget } from './reviewTarget.ts';
import { stackPosition } from './stackReview.ts';

function pull(
  number: number,
  headRef: string,
  baseRef: string,
  author = 'ada'
): PullSummary {
  return {
    owner: 'acme',
    repo: 'app',
    number,
    title: `Change ${number}`,
    author,
    state: 'open',
    htmlUrl: `https://github.com/acme/app/pull/${number}`,
    updatedAt: '2026-08-20T00:00:00Z',
    headRef,
    baseRef,
  };
}

function target(number: number): GitHubPullTarget {
  return { kind: 'github-pull', owner: 'acme', repo: 'app', number };
}

const chain = [
  pull(1, 'part-1', 'main'),
  pull(2, 'part-2', 'part-1'),
  pull(3, 'part-3', 'part-2'),
];

describe('stackPosition', () => {
  it('goes on to the layer stacked on this one', () => {
    const at = stackPosition(chain, target(1));
    assert.equal(at?.position, 1);
    assert.equal(at?.total, 3);
    assert.equal(at?.next?.number, 2);
  });

  it('has no next layer on the last one', () => {
    const at = stackPosition(chain, target(3));
    assert.equal(at?.position, 3);
    assert.equal(at?.total, 3);
    assert.equal(at?.next, undefined);
  });

  it('is nothing for a pull request that stands alone', () => {
    const pulls = [...chain, pull(9, 'solo', 'main')];
    assert.equal(stackPosition(pulls, target(9)), undefined);
  });

  it('is nothing for a pull request the list does not hold', () => {
    assert.equal(stackPosition(chain, target(42)), undefined);
    assert.equal(stackPosition(chain, undefined), undefined);
  });

  it('follows the order the bar draws a branching stack in', () => {
    // Two layers on #1: the bar draws the newer one first, then the older,
    // so the older is next after the newer even though it is not stacked on it.
    const pulls = [
      pull(1, 'base', 'main'),
      pull(2, 'left', 'base'),
      pull(3, 'right', 'base'),
    ];
    assert.equal(stackPosition(pulls, target(1))?.next?.number, 3);
    assert.equal(stackPosition(pulls, target(3))?.next?.number, 2);
    assert.equal(stackPosition(pulls, target(2))?.next, undefined);
  });

  it('keeps to one author, the way the bar builds stacks', () => {
    const pulls = [...chain, pull(4, 'part-4', 'part-3', 'grace')];
    assert.equal(stackPosition(pulls, target(3))?.next, undefined);
  });
});
