import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PullSummary } from './pulls.ts';
import {
  availablePullScopes,
  countPullScopes,
  currentStackPulls,
  effectivePullScope,
  scopePulls,
} from './pullScope.ts';

function pull(
  author: string,
  number: number,
  headRef: string,
  baseRef = 'main',
  overrides: Partial<PullSummary> = {}
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
    ...overrides,
  };
}

// Galvin's three-part stack and one pull request on its own, Ada's two, and a
// pull request of Grace's on Galvin's branch — another author, so not his stack.
const pulls = [
  pull('galvin', 1, 'part-1'),
  pull('galvin', 2, 'part-2', 'part-1'),
  pull('galvin', 3, 'part-3', 'part-2'),
  pull('galvin', 4, 'alone'),
  pull('ada', 5, 'ada-1'),
  pull('ada', 6, 'ada-2', 'ada-1'),
  pull('grace', 7, 'grace-1', 'part-3'),
];

const at = (number: number) => ({
  kind: 'github-pull' as const,
  owner: 'Acme',
  repo: 'App',
  number,
});

const numbers = (list: readonly PullSummary[] | undefined) =>
  list?.map((item) => item.number);

describe('currentStackPulls', () => {
  it('finds the whole stack from any pull request in it', () => {
    assert.deepEqual(numbers(currentStackPulls(pulls, at(1))), [1, 2, 3]);
    assert.deepEqual(numbers(currentStackPulls(pulls, at(3))), [1, 2, 3]);
  });

  it('keeps another author out of the stack, as the list does', () => {
    assert.equal(currentStackPulls(pulls, at(7)), undefined);
  });

  it('answers with nothing for a pull request on its own', () => {
    assert.equal(currentStackPulls(pulls, at(4)), undefined);
  });

  it('answers with nothing off a pull request, or off the list', () => {
    assert.equal(currentStackPulls(pulls, undefined), undefined);
    assert.equal(currentStackPulls(pulls, at(99)), undefined);
    assert.equal(
      currentStackPulls(pulls, { ...at(1), repo: 'other' }),
      undefined
    );
  });
});

describe('countPullScopes', () => {
  it("counts the viewer's own without regard to case", () => {
    const counts = countPullScopes(pulls, 'GALVIN', at(2));
    assert.equal(counts.mine, 4);
    assert.equal(counts.others, 3);
    assert.equal(counts.stack?.length, 3);
  });

  it('counts everything as somebody else’s when signed out', () => {
    const counts = countPullScopes(pulls, undefined, undefined);
    assert.equal(counts.mine, 0);
    assert.equal(counts.others, pulls.length);
    assert.equal(counts.stack, undefined);
  });
});

describe('effectivePullScope', () => {
  const withStack = countPullScopes(pulls, 'galvin', at(1));
  const without = countPullScopes(pulls, 'galvin', at(4));

  it('keeps a scope the moment can honour', () => {
    assert.equal(effectivePullScope('mine', 'galvin', without), 'mine');
    assert.equal(effectivePullScope('others', 'galvin', without), 'others');
    assert.equal(effectivePullScope('stack', 'galvin', withStack), 'stack');
  });

  it('falls back to everything rather than to an empty list', () => {
    assert.equal(effectivePullScope('stack', 'galvin', without), 'all');
    assert.equal(effectivePullScope('mine', undefined, without), 'all');
    assert.equal(effectivePullScope('others', undefined, without), 'all');
  });
});

describe('scopePulls', () => {
  const counts = countPullScopes(pulls, 'galvin', at(2));

  it('draws each scope', () => {
    assert.equal(scopePulls(pulls, 'galvin', 'all', counts), pulls);
    assert.deepEqual(
      numbers(scopePulls(pulls, 'galvin', 'mine', counts)),
      [1, 2, 3, 4]
    );
    assert.deepEqual(
      numbers(scopePulls(pulls, 'galvin', 'others', counts)),
      [5, 6, 7]
    );
    assert.deepEqual(
      numbers(scopePulls(pulls, 'galvin', 'stack', counts)),
      [1, 2, 3]
    );
  });
});

describe('availablePullScopes', () => {
  it('offers the author tabs only to a viewer, and the stack only in one', () => {
    const inStack = countPullScopes(pulls, 'galvin', at(1));
    const alone = countPullScopes(pulls, 'galvin', at(4));
    assert.deepEqual(availablePullScopes('galvin', inStack), [
      'all',
      'mine',
      'others',
      'stack',
    ]);
    assert.deepEqual(availablePullScopes('galvin', alone), [
      'all',
      'mine',
      'others',
    ]);
    assert.deepEqual(availablePullScopes(undefined, inStack), ['all', 'stack']);
    assert.deepEqual(availablePullScopes(undefined, alone), ['all']);
  });
});
