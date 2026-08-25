import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  countRepoPulls,
  dedupeWatchedRepos,
  flattenStacks,
  formatWatchedRepo,
  groupPullsByRepo,
  groupReposByOwner,
  parseWatchedRepo,
  pullState,
  type PullSummary,
} from './pulls.ts';

function pull(
  author: string,
  number: number,
  updatedAt: string,
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
    updatedAt,
    headRef: `feature/${number}`,
    baseRef: 'main',
    ...overrides,
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

describe('groupReposByOwner', () => {
  it('sorts owners and their repositories by name', () => {
    const groups = groupReposByOwner([
      { owner: 'zeta', repo: 'tools' },
      { owner: 'acme', repo: 'web' },
      { owner: 'acme', repo: 'api' },
    ]);
    assert.deepEqual(
      groups.map((group) => group.owner),
      ['acme', 'zeta']
    );
    assert.deepEqual(
      groups[0].repos.map((repo) => repo.repo),
      ['api', 'web']
    );
  });

  it('reads one owner written two ways as one owner', () => {
    const groups = groupReposByOwner([
      { owner: 'Acme', repo: 'web' },
      { owner: 'acme', repo: 'api' },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].repos.length, 2);
  });
});

describe('groupPullsByRepo', () => {
  const pulls = [
    pull('galvin', 1, '2026-08-20T00:00:00Z'),
    pull('galvin', 2, '2026-08-24T00:00:00Z'),
    pull('ada', 3, '2026-08-22T00:00:00Z'),
    pull('grace', 4, '2026-08-25T00:00:00Z'),
    pull('ada', 5, '2026-08-23T00:00:00Z'),
    pull('ada', 6, '2026-08-21T00:00:00Z', { owner: 'zeta', repo: 'tools' }),
  ];

  it('groups by repository, alphabetically by owner then repository', () => {
    const groups = groupPullsByRepo(pulls, 'galvin');
    assert.deepEqual(
      groups.map((group) => group.key),
      ['acme/app', 'zeta/tools']
    );
    assert.equal(groups[0].count, 5);
    assert.equal(countRepoPulls(groups[0]), 5);
  });

  it('puts the viewer first among the authors', () => {
    const groups = groupPullsByRepo(pulls, 'galvin');
    assert.deepEqual(
      groups[0].authors.map((author) => author.author),
      ['galvin', 'grace', 'ada']
    );
    assert.equal(groups[0].authors[0].isViewer, true);
    assert.equal(groups[0].authors[1].isViewer, false);
  });

  it('reads the viewer login without regard to case', () => {
    const groups = groupPullsByRepo(pulls, 'GALVIN');
    assert.equal(groups[0].authors[0].author, 'galvin');
    assert.equal(groups[0].authors[0].isViewer, true);
  });

  it('marks nobody as the viewer when there is no token', () => {
    const groups = groupPullsByRepo(pulls, undefined);
    assert.equal(
      groups[0].authors.every((author) => !author.isViewer),
      true
    );
    // Without a viewer the authors go by their newest pull request.
    assert.deepEqual(
      groups[0].authors.map((author) => author.author),
      ['grace', 'galvin', 'ada']
    );
  });

  it("orders an author's unstacked pull requests by number, newest first", () => {
    const groups = groupPullsByRepo(pulls, 'galvin');
    const ada = groups[0].authors[2];
    assert.deepEqual(
      flattenStacks(ada.stacks).map((node) => node.pull.number),
      [5, 3]
    );
  });

  it('nests a stack under the pull request it stands on', () => {
    const stacked = [
      pull('ada', 10, '2026-08-20T00:00:00Z', {
        headRef: 'part-1',
        baseRef: 'main',
      }),
      pull('ada', 11, '2026-08-21T00:00:00Z', {
        headRef: 'part-2',
        baseRef: 'part-1',
      }),
      pull('ada', 12, '2026-08-22T00:00:00Z', {
        headRef: 'part-3',
        baseRef: 'part-2',
      }),
    ];
    const authors = groupPullsByRepo(stacked, undefined)[0].authors;
    assert.equal(authors[0].stacks.length, 1);
    assert.deepEqual(
      flattenStacks(authors[0].stacks).map((node) => node.pull.number),
      [10, 11, 12]
    );
  });

  it('keeps a stack inside its author, so two people never share one chain', () => {
    const crossAuthor = [
      pull('ada', 20, '2026-08-20T00:00:00Z', {
        headRef: 'part-1',
        baseRef: 'main',
      }),
      pull('grace', 21, '2026-08-21T00:00:00Z', {
        headRef: 'part-2',
        baseRef: 'part-1',
      }),
    ];
    const authors = groupPullsByRepo(crossAuthor, undefined)[0].authors;
    for (const author of authors) {
      assert.equal(author.stacks.length, 1);
      assert.equal(author.stacks[0].children.length, 0);
    }
  });

  it('returns no groups for no pull requests', () => {
    assert.deepEqual(groupPullsByRepo([], 'galvin'), []);
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
