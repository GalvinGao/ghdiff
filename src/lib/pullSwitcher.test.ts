import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  dedupeWatchedRepos,
  formatWatchedRepo,
  groupPulls,
  parseWatchedRepo,
  pullState,
  type PullSummary,
} from './pullSwitcher.ts';

function pull(author: string, number: number, updatedAt: string): PullSummary {
  return {
    owner: 'acme',
    repo: 'app',
    number,
    title: `Change ${number}`,
    author,
    state: 'open',
    htmlUrl: `https://github.com/acme/app/pull/${number}`,
    updatedAt,
    headRef: `feature/${number}`,
    baseRef: 'main',
  };
}

describe('parseWatchedRepo', () => {
  it('parses owner/repo', () => {
    assert.deepEqual(parseWatchedRepo('acme/app'), {
      owner: 'acme',
      repo: 'app',
    });
  });

  it('parses a github URL', () => {
    assert.deepEqual(parseWatchedRepo('https://github.com/acme/app'), {
      owner: 'acme',
      repo: 'app',
    });
  });

  it('drops a trailing .git and slash', () => {
    assert.deepEqual(parseWatchedRepo('acme/app.git'), {
      owner: 'acme',
      repo: 'app',
    });
    assert.deepEqual(parseWatchedRepo('acme/app/'), {
      owner: 'acme',
      repo: 'app',
    });
  });

  it('rejects input that is not a repository', () => {
    assert.equal(parseWatchedRepo('acme'), undefined);
    assert.equal(parseWatchedRepo('acme/app/extra'), undefined);
    assert.equal(parseWatchedRepo(''), undefined);
  });
});

describe('dedupeWatchedRepos', () => {
  it('removes repeats without regard to case', () => {
    const result = dedupeWatchedRepos([
      { owner: 'acme', repo: 'app' },
      { owner: 'Acme', repo: 'App' },
      { owner: 'acme', repo: 'lib' },
    ]);
    assert.deepEqual(result.map(formatWatchedRepo), ['acme/app', 'acme/lib']);
  });
});

describe('groupPulls', () => {
  const pulls = [
    pull('galvin', 1, '2026-08-20T00:00:00Z'),
    pull('galvin', 2, '2026-08-24T00:00:00Z'),
    pull('ada', 3, '2026-08-22T00:00:00Z'),
    pull('grace', 4, '2026-08-25T00:00:00Z'),
    pull('ada', 5, '2026-08-23T00:00:00Z'),
  ];

  it('puts the pull requests of the viewer under Yours', () => {
    const groups = groupPulls(pulls, 'galvin');
    assert.deepEqual(
      groups.map((group) => group.kind),
      ['yours', 'others']
    );
    const yours = groups[0];
    assert.equal(yours.count, 2);
    assert.equal(yours.authors.length, 1);
    assert.deepEqual(
      yours.authors[0].pulls.map((item) => item.number),
      [2, 1]
    );
  });

  it('matches the viewer login without regard to case', () => {
    const groups = groupPulls(pulls, 'GALVIN');
    assert.equal(groups[0].kind, 'yours');
    assert.equal(groups[0].count, 2);
  });

  it('groups other people by author, newest author first', () => {
    const others = groupPulls(pulls, 'galvin')[1];
    assert.deepEqual(
      others.authors.map((group) => group.author),
      ['grace', 'ada']
    );
    assert.deepEqual(
      others.authors[1].pulls.map((item) => item.number),
      [5, 3]
    );
    assert.equal(others.count, 3);
  });

  it('puts everything under Others when there is no viewer', () => {
    const groups = groupPulls(pulls, undefined);
    assert.deepEqual(
      groups.map((group) => group.kind),
      ['others']
    );
    assert.equal(groups[0].count, pulls.length);
  });

  it('omits an empty group', () => {
    const groups = groupPulls(
      [pull('galvin', 9, '2026-08-01T00:00:00Z')],
      'galvin'
    );
    assert.deepEqual(
      groups.map((group) => group.kind),
      ['yours']
    );
  });

  it('returns no groups for no pull requests', () => {
    assert.deepEqual(groupPulls([], 'galvin'), []);
  });
});

describe('pullState', () => {
  it('reads a plain open pull request', () => {
    assert.equal(pullState({ state: 'open' }), 'open');
  });

  it('reads a draft', () => {
    assert.equal(pullState({ state: 'open', draft: true }), 'draft');
  });

  it('reads a merged pull request, even though it is also closed', () => {
    assert.equal(
      pullState({ state: 'closed', merged_at: '2026-08-01T00:00:00Z' }),
      'merged'
    );
  });

  it('reads a closed pull request that was never merged', () => {
    assert.equal(pullState({ state: 'closed', merged_at: null }), 'closed');
  });

  it('prefers merged over draft, which GitHub can report together', () => {
    assert.equal(
      pullState({
        state: 'closed',
        draft: true,
        merged_at: '2026-08-01T00:00:00Z',
      }),
      'merged'
    );
  });

  it('defaults to open when GitHub sends nothing useful', () => {
    assert.equal(pullState({}), 'open');
  });
});
