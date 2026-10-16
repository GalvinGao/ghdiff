import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { watchedRepoName } from './pulls';
import {
  countRepoPulls,
  dedupeWatchedRepos,
  failedSetupAccount,
  flattenStacks,
  formatWatchedRepo,
  gluedWatchedRepo,
  groupPullsByRepo,
  groupReposByOwner,
  parseWatchedRepo,
  pullState,
  type PullSummary,
  type WatchedRepo,
} from './pulls';

/** The hosts of a two-instance deployment, first one the default. */
const HOSTS = ['gitlab.com', 'gitlab.corp.com'];

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
  it('parses owner/repo as GitHub, hosts configured or not', () => {
    assert.deepEqual(parseWatchedRepo('acme/app', HOSTS), {
      owner: 'acme',
      repo: 'app',
    });
    assert.deepEqual(parseWatchedRepo('acme/app', []), {
      owner: 'acme',
      repo: 'app',
    });
  });

  it('parses a github URL', () => {
    assert.deepEqual(parseWatchedRepo('https://github.com/acme/app', HOSTS), {
      owner: 'acme',
      repo: 'app',
    });
  });

  it('parses the canonical github.com: form', () => {
    assert.deepEqual(parseWatchedRepo('github.com:acme/app', HOSTS), {
      owner: 'acme',
      repo: 'app',
    });
  });

  it('drops a trailing .git and slash', () => {
    assert.deepEqual(parseWatchedRepo('acme/app.git', HOSTS), {
      owner: 'acme',
      repo: 'app',
    });
    assert.deepEqual(parseWatchedRepo('acme/app/', HOSTS), {
      owner: 'acme',
      repo: 'app',
    });
  });

  it('rejects input that is not a repository', () => {
    assert.equal(parseWatchedRepo('acme', HOSTS), undefined);
    assert.equal(parseWatchedRepo('', HOSTS), undefined);
    assert.equal(parseWatchedRepo('acme/app/extra', []), undefined);
  });

  it('reads a bare nested path as a project on the first configured host', () => {
    assert.deepEqual(parseWatchedRepo('acme/sub/app', HOSTS), {
      forge: 'gitlab',
      host: 'gitlab.com',
      project: 'acme/sub/app',
    });
    // With no host configured, a bare nested path names nothing.
    assert.equal(parseWatchedRepo('acme/sub/app', []), undefined);
  });

  it('reads host:path as a project on that host', () => {
    assert.deepEqual(parseWatchedRepo('gitlab.corp.com:acme/app', HOSTS), {
      forge: 'gitlab',
      host: 'gitlab.corp.com',
      project: 'acme/app',
    });
  });

  it('matches a named host without regard to case', () => {
    assert.deepEqual(parseWatchedRepo('GITLAB.corp.com:acme/app', HOSTS), {
      forge: 'gitlab',
      host: 'gitlab.corp.com',
      project: 'acme/app',
    });
  });

  it('reads a URL on a configured host, `/-/` and all', () => {
    assert.deepEqual(
      parseWatchedRepo('https://gitlab.corp.com/acme/app', HOSTS),
      {
        forge: 'gitlab',
        host: 'gitlab.corp.com',
        project: 'acme/app',
      }
    );
    assert.deepEqual(
      parseWatchedRepo(
        'https://gitlab.corp.com/acme/app/-/merge_requests/1',
        HOSTS
      ),
      {
        forge: 'gitlab',
        host: 'gitlab.corp.com',
        project: 'acme/app',
      }
    );
  });

  it('rejects a host the deployment does not serve', () => {
    assert.equal(
      parseWatchedRepo('gitlab.other.com/acme/app', HOSTS),
      undefined
    );
    assert.equal(
      parseWatchedRepo('gitlab.other.com:acme/app', HOSTS),
      undefined
    );
    assert.equal(
      parseWatchedRepo('https://gitlab.corp.com/acme/app', []),
      undefined
    );
  });

  it('keeps a host its port', () => {
    assert.deepEqual(
      parseWatchedRepo('https://gitlab.corp.com:8443/acme/app', [
        'gitlab.corp.com:8443',
      ]),
      {
        forge: 'gitlab',
        host: 'gitlab.corp.com:8443',
        project: 'acme/app',
      }
    );
    assert.deepEqual(
      parseWatchedRepo('gitlab.corp.com:8443:acme/app', [
        'gitlab.corp.com:8443',
      ]),
      {
        forge: 'gitlab',
        host: 'gitlab.corp.com:8443',
        project: 'acme/app',
      }
    );
  });

  it('round-trips a GitLab row through its own label', () => {
    const repo = parseWatchedRepo('gitlab.corp.com:acme/sub/app', HOSTS);
    assert.ok(repo != null);
    assert.deepEqual(parseWatchedRepo(formatWatchedRepo(repo), HOSTS), repo);
  });
});

describe('gluedWatchedRepo', () => {
  it('round-trips through the parse for every host shape', () => {
    const repos: WatchedRepo[] = [
      { owner: 'acme', repo: 'app' },
      { forge: 'gitlab', host: 'gitlab.corp.com', project: 'group/proj' },
      { forge: 'gitlab', host: 'gitlab.corp.com:8443', project: 'group/proj' },
      // A single-label host glued with a colon cannot be misread as a
      // namespace, the way its `host/project` display label can.
      { forge: 'gitlab', host: 'localhost', project: 'group/proj' },
    ];
    for (const repo of repos) {
      const hosts = repo.forge === 'gitlab' ? [repo.host] : [];
      assert.deepEqual(
        parseWatchedRepo(gluedWatchedRepo(repo), hosts),
        repo,
        gluedWatchedRepo(repo)
      );
    }
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
      groups[0].repos.map((repo) => watchedRepoName(repo)),
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
    const groups = groupPullsByRepo(pulls, { github: 'galvin' });
    assert.deepEqual(
      groups.map((group) => group.key),
      ['acme/app', 'zeta/tools']
    );
    assert.equal(groups[0].count, 5);
    assert.equal(countRepoPulls(groups[0]), 5);
  });

  it('orders repositories as the watch list does, then the rest by name', () => {
    const more = [
      ...pulls,
      pull('ada', 7, '2026-08-21T00:00:00Z', { owner: 'mid', repo: 'x' }),
    ];
    const groups = groupPullsByRepo(
      more,
      { github: 'galvin' },
      {
        order: [
          { owner: 'Zeta', repo: 'Tools' },
          { owner: 'acme', repo: 'app' },
        ],
      }
    );
    assert.deepEqual(
      groups.map((group) => group.key),
      ['zeta/tools', 'acme/app', 'mid/x']
    );
  });

  it('puts the viewer first among the authors', () => {
    const groups = groupPullsByRepo(pulls, { github: 'galvin' });
    assert.deepEqual(
      groups[0].authors.map((author) => author.author),
      ['galvin', 'grace', 'ada']
    );
    assert.equal(groups[0].authors[0].isViewer, true);
    assert.equal(groups[0].authors[1].isViewer, false);
  });

  it('reads the viewer login without regard to case', () => {
    const groups = groupPullsByRepo(pulls, { github: 'GALVIN' });
    assert.equal(groups[0].authors[0].author, 'galvin');
    assert.equal(groups[0].authors[0].isViewer, true);
  });

  it('marks nobody as the viewer when there is no token', () => {
    const groups = groupPullsByRepo(pulls, {});
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

  it('marks a row as the viewer’s only on its own forge group’s answer', () => {
    const rows = [
      pull('galvin', 1, '2026-08-20T00:00:00Z'),
      pull('galvin', 2, '2026-08-21T00:00:00Z', {
        forge: 'gitlab',
        host: 'gitlab.corp.com',
        project: 'acme/app',
        htmlUrl: 'https://gitlab.corp.com/acme/app/-/merge_requests/2',
      }),
    ];
    const isViewer = (viewers: Record<string, string>) => {
      const groups = groupPullsByRepo(rows, viewers);
      return [
        groups.find((group) => group.key === 'acme/app')?.authors[0].isViewer,
        groups.find((group) => group.key === 'gitlab.corp.com/acme/app')
          ?.authors[0].isViewer,
      ];
    };
    // A login that matches across forges is not the same person: the GitHub
    // viewer names nobody on GitLab.
    assert.deepEqual(isViewer({ github: 'galvin' }), [true, false]);
    // The host's own viewer names its own rows, and nobody else's.
    assert.deepEqual(
      isViewer({ github: 'galvin', 'gitlab:gitlab.corp.com': 'galvin' }),
      [true, true]
    );
    assert.deepEqual(isViewer({ 'gitlab:gitlab.corp.com': 'galvin' }), [
      false,
      true,
    ]);
  });

  it("orders an author's unstacked pull requests by number, newest first", () => {
    const groups = groupPullsByRepo(pulls, { github: 'galvin' });
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
    const authors = groupPullsByRepo(stacked, {})[0].authors;
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
    const authors = groupPullsByRepo(crossAuthor, {})[0].authors;
    for (const author of authors) {
      assert.equal(author.stacks.length, 1);
      assert.equal(author.stacks[0].children.length, 0);
    }
  });

  it('puts what is waiting on the reviewer first in its author group', () => {
    const requested = [
      pull('ada', 3, '2026-08-22T00:00:00Z', { reviewRequested: true }),
      pull('ada', 5, '2026-08-23T00:00:00Z'),
    ];
    const authors = groupPullsByRepo(requested, {})[0].authors;
    assert.deepEqual(
      flattenStacks(authors[0].stacks).map((node) => node.pull.number),
      [3, 5]
    );
  });

  it('bubbles a stack as one block when any member requests the reviewer', () => {
    const requested = [
      pull('ada', 10, '2026-08-20T00:00:00Z', {
        headRef: 'part-1',
        baseRef: 'main',
      }),
      pull('ada', 11, '2026-08-21T00:00:00Z', {
        headRef: 'part-2',
        baseRef: 'part-1',
        reviewRequested: true,
      }),
      pull('ada', 13, '2026-08-22T00:00:00Z'),
    ];
    const authors = groupPullsByRepo(requested, {})[0].authors;
    // The chain leads although its root is not the requested one, and the
    // chain's own order holds inside it.
    assert.deepEqual(
      flattenStacks(authors[0].stacks).map((node) => node.pull.number),
      [10, 11, 13]
    );
  });

  it('moves nothing when no row requests the reviewer', () => {
    const groups = groupPullsByRepo(pulls, { github: 'galvin' });
    const ada = groups[0].authors[2];
    assert.deepEqual(
      flattenStacks(ada.stacks).map((node) => node.pull.number),
      [5, 3]
    );
  });

  it('returns no groups for no pull requests', () => {
    assert.deepEqual(groupPullsByRepo([], { github: 'galvin' }), []);
  });
});

describe('failedSetupAccount', () => {
  it('names the one owner every failing GitHub row shares', () => {
    assert.equal(
      failedSetupAccount([{ repo: 'acme/app' }, { repo: 'acme/lib' }], true),
      'acme'
    );
  });

  it('asks the general question when two owners fail', () => {
    assert.equal(
      failedSetupAccount([{ repo: 'acme/app' }, { repo: 'zeta/tools' }], true),
      undefined
    );
  });

  it('offers nothing when nothing failed or nobody is signed in', () => {
    assert.equal(failedSetupAccount([], true), null);
    assert.equal(failedSetupAccount([{ repo: 'acme/app' }], false), null);
  });

  it('leaves GitLab rows out of the offer', () => {
    // A GitLab failure names `host:project`, and the setup page has no
    // installation step to offer a project.
    assert.equal(
      failedSetupAccount([{ repo: 'gitlab.corp.com:group/proj' }], true),
      null
    );
    // A port host mangles nothing either: the row is still no GitHub owner.
    assert.equal(
      failedSetupAccount(
        [{ repo: 'gitlab.corp.com:8443:group/proj' }, { repo: 'acme/app' }],
        true
      ),
      'acme'
    );
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
