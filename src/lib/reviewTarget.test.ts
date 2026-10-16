import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { pullRefFromTarget } from './forges';
import {
  classifyRouteSegments,
  describeReviewTarget,
  isForgeTarget,
  type LocalDiffTarget,
  parseCompareRange,
  repoNameFromRoot,
  reviewTabTitle,
  reviewTabType,
  reviewTargetFromQuery,
  reviewTargetFromSegments,
  reviewTargetKey,
  reviewTargetQuery,
  reviewTargetSearch,
  reviewTargetSplat,
  segmentsFromPath,
} from './reviewTarget';

describe('reviewTargetFromSegments', () => {
  it('parses a GitHub pull request in the colon form', () => {
    assert.deepEqual(
      reviewTargetFromSegments(['github.com:oven-sh', 'bun', 'pull', '30412']),
      { kind: 'github-pull', owner: 'oven-sh', repo: 'bun', number: 30412 }
    );
  });

  it('parses a GitHub commit in the colon form', () => {
    assert.deepEqual(
      reviewTargetFromSegments([
        'github.com:pierrecomputer',
        'pierre',
        'commit',
        '0800fbaa',
      ]),
      {
        kind: 'github-commit',
        owner: 'pierrecomputer',
        repo: 'pierre',
        sha: '0800fbaa',
      }
    );
  });

  it('parses a GitHub compare range in the colon form', () => {
    assert.deepEqual(
      reviewTargetFromSegments([
        'github.com:torvalds',
        'linux',
        'compare',
        'v6.0...v6.1',
      ]),
      {
        kind: 'github-compare',
        owner: 'torvalds',
        repo: 'linux',
        base: 'v6.0',
        head: 'v6.1',
      }
    );
  });

  it('parses a GitLab merge request in the colon form', () => {
    assert.deepEqual(
      reviewTargetFromSegments([
        'gitlab.com:gitlab-org',
        'gitlab',
        '-',
        'merge_requests',
        '17',
      ]),
      {
        kind: 'gitlab-mr',
        host: 'gitlab.com',
        project: 'gitlab-org/gitlab',
        number: 17,
      }
    );
  });

  it('parses a GitLab commit in the colon form', () => {
    assert.deepEqual(
      reviewTargetFromSegments([
        'gitlab.com:team',
        'repo',
        '-',
        'commit',
        '0800fbaa',
      ]),
      {
        kind: 'gitlab-commit',
        host: 'gitlab.com',
        project: 'team/repo',
        sha: '0800fbaa',
      }
    );
  });

  it('parses a GitLab compare range in the colon form', () => {
    assert.deepEqual(
      reviewTargetFromSegments([
        'gitlab.com:team',
        'repo',
        '-',
        'compare',
        'v1.0...v1.1',
      ]),
      {
        kind: 'gitlab-compare',
        host: 'gitlab.com',
        project: 'team/repo',
        base: 'v1.0',
        head: 'v1.1',
      }
    );
  });

  it('keeps the port with the host', () => {
    assert.deepEqual(
      reviewTargetFromSegments([
        'gitlab.corp.com:8443:team',
        'sub',
        'repo',
        '-',
        'merge_requests',
        '3',
      ]),
      {
        kind: 'gitlab-mr',
        host: 'gitlab.corp.com:8443',
        project: 'team/sub/repo',
        number: 3,
      }
    );
  });

  it('parses a host this deployment is not configured for', () => {
    // Membership is the server-side forge gate's question, not the parse's:
    // the target is real, and the gate's 404 names the served hosts.
    assert.deepEqual(
      reviewTargetFromSegments([
        'gitlab.unknown.example:g',
        'r',
        '-',
        'merge_requests',
        '1',
      ]),
      {
        kind: 'gitlab-mr',
        host: 'gitlab.unknown.example',
        project: 'g/r',
        number: 1,
      }
    );
  });

  it('reads a dotted GitLab group as a project, unambiguously', () => {
    // The colon form names the host outright, so a dotted first path segment
    // is a namespace again — the old segment form's ambiguity is gone.
    assert.deepEqual(
      reviewTargetFromSegments([
        'gitlab.com:that.group',
        'sub',
        'repo',
        '-',
        'merge_requests',
        '1',
      ]),
      {
        kind: 'gitlab-mr',
        host: 'gitlab.com',
        project: 'that.group/sub/repo',
        number: 1,
      }
    );
  });

  it('lowercases the host', () => {
    const target = reviewTargetFromSegments([
      'GITLAB.com:g',
      'r',
      '-',
      'merge_requests',
      '1',
    ]);
    assert.deepEqual(target, {
      kind: 'gitlab-mr',
      host: 'gitlab.com',
      project: 'g/r',
      number: 1,
    });
  });

  it('is canonical-only: a hostless path is not a target', () => {
    assert.equal(reviewTargetFromSegments(['a', 'b', 'pull', '7']), undefined);
    assert.equal(
      reviewTargetFromSegments(['group', 'repo', '-', 'merge_requests', '42']),
      undefined
    );
  });

  it('reads host:port with no second colon as the legacy form, not the colon form', () => {
    // `gitlab.corp.com:8443` alone is a host with a port, not a host glued to
    // a path segment — the digits are the port, so this is not canonical.
    assert.equal(
      reviewTargetFromSegments([
        'gitlab.corp.com:8443',
        'group',
        'repo',
        '-',
        'commit',
        'deadbeef',
      ]),
      undefined
    );
  });

  it('rejects what no grammar holds', () => {
    assert.equal(
      reviewTargetFromSegments(['github.com:a', 'b', 'pull', '0']),
      undefined
    );
    assert.equal(
      reviewTargetFromSegments(['github.com:a', 'b', 'pull', 'x']),
      undefined
    );
    assert.equal(
      reviewTargetFromSegments(['github.com:a', 'b', 'commit', 'abc']),
      undefined
    );
    // A one-segment project is no GitLab project: it always has a namespace.
    assert.equal(
      reviewTargetFromSegments([
        'gitlab.com:repo',
        '-',
        'merge_requests',
        '42',
      ]),
      undefined
    );
    assert.equal(
      reviewTargetFromSegments(['gitlab.com:g', 'r', '-', 'issues', '42']),
      undefined
    );
    assert.equal(
      reviewTargetFromSegments([
        'gitlab.com:g',
        'r',
        '-',
        'merge_requests',
        'x',
      ]),
      undefined
    );
  });

  it('accepts a percent-encoded compare range', () => {
    assert.deepEqual(
      reviewTargetFromSegments([
        'github.com:a',
        'b',
        'compare',
        encodeURIComponent('main...feature/x'),
      ]),
      {
        kind: 'github-compare',
        owner: 'a',
        repo: 'b',
        base: 'main',
        head: 'feature/x',
      }
    );
  });

  it('keeps a branch name that holds a percent sign', () => {
    assert.deepEqual(
      reviewTargetFromSegments([
        'github.com:a',
        'b',
        'compare',
        'main...fix-100%',
      ]),
      {
        kind: 'github-compare',
        owner: 'a',
        repo: 'b',
        base: 'main',
        head: 'fix-100%',
      }
    );
  });

  it('reads a merge request past a trailing tab segment', () => {
    assert.deepEqual(
      reviewTargetFromSegments([
        'gitlab.com:group',
        'repo',
        '-',
        'merge_requests',
        '42',
        'diffs',
      ]),
      {
        kind: 'gitlab-mr',
        host: 'gitlab.com',
        project: 'group/repo',
        number: 42,
      }
    );
  });
});

describe('classifyRouteSegments', () => {
  it('parses the colon form into a target', () => {
    assert.deepEqual(
      classifyRouteSegments(['github.com:a', 'b', 'pull', '7']),
      {
        kind: 'target',
        target: { kind: 'github-pull', owner: 'a', repo: 'b', number: 7 },
      }
    );
  });

  it('is none when the colon form holds no grammar', () => {
    assert.deepEqual(classifyRouteSegments(['github.com:a', 'b']), {
      kind: 'none',
    });
  });

  it('redirects the legacy dotted-host form to the colon form, permanently', () => {
    assert.deepEqual(
      classifyRouteSegments([
        'gitlab.corp.com',
        'group',
        'repo',
        '-',
        'merge_requests',
        '42',
      ]),
      {
        kind: 'redirect',
        splat: 'gitlab.corp.com:group/repo/-/merge_requests/42',
        status: 301,
      }
    );
  });

  it('redirects the legacy host-with-port form, keeping the port', () => {
    assert.deepEqual(
      classifyRouteSegments([
        'gitlab.corp.com:8443',
        'group',
        'repo',
        '-',
        'commit',
        'deadbeef',
      ]),
      {
        kind: 'redirect',
        splat: 'gitlab.corp.com:8443:group/repo/-/commit/deadbeef',
        status: 301,
      }
    );
  });

  it('reads a dotted first segment as a host only with two segments before the marker', () => {
    // `that.group/repo` is a project to guess a host for, not a legacy host.
    assert.deepEqual(
      classifyRouteSegments(['that.group', 'repo', '-', 'merge_requests', '1']),
      { kind: 'resolve', splat: 'that.group/repo/-/merge_requests/1' }
    );
  });

  it('sends a bare GitLab path to resolve', () => {
    assert.deepEqual(
      classifyRouteSegments(['group', 'repo', '-', 'merge_requests', '42']),
      { kind: 'resolve', splat: 'group/repo/-/merge_requests/42' }
    );
  });

  it('redirects a hostless GitHub path to the one GitHub host', () => {
    assert.deepEqual(classifyRouteSegments(['a', 'b', 'pull', '7']), {
      kind: 'redirect',
      splat: 'github.com:a/b/pull/7',
      status: 302,
    });
  });

  it('redirects the pulls and commits aliases too', () => {
    assert.deepEqual(classifyRouteSegments(['a', 'b', 'pulls', '7']), {
      kind: 'redirect',
      splat: 'github.com:a/b/pulls/7',
      status: 302,
    });
    assert.deepEqual(classifyRouteSegments(['a', 'b', 'commits', 'deadbeef']), {
      kind: 'redirect',
      splat: 'github.com:a/b/commits/deadbeef',
      status: 302,
    });
    assert.deepEqual(
      classifyRouteSegments(['a', 'b', 'compare', 'main...topic']),
      {
        kind: 'redirect',
        splat: 'github.com:a/b/compare/main...topic',
        status: 302,
      }
    );
  });

  it('does not redirect a colon head the canonical grammar rejects', () => {
    // Gluing such a head again would classify the same way: a redirect loop.
    assert.deepEqual(classifyRouteSegments(['a_b:c']), { kind: 'none' });
    assert.deepEqual(classifyRouteSegments(['@x:y', 'z']), { kind: 'none' });
    assert.deepEqual(
      classifyRouteSegments(['a_b.com', 'g', 'p', '-', 'merge_requests', '1']),
      { kind: 'none' }
    );
  });

  it('is none for anything else', () => {
    assert.deepEqual(classifyRouteSegments([]), { kind: 'none' });
    assert.deepEqual(classifyRouteSegments(['hello']), { kind: 'none' });
    assert.deepEqual(classifyRouteSegments(['a', 'b']), { kind: 'none' });
    // A GitHub shape that fails the grammar does not redirect to a 404.
    assert.deepEqual(classifyRouteSegments(['a', 'b', 'pull', '0']), {
      kind: 'none',
    });
    // A one-segment project is no GitLab project, so a bare one is not a
    // resolve input either — it names no page the grammar can read.
    assert.deepEqual(
      classifyRouteSegments(['repo', '-', 'merge_requests', '1']),
      { kind: 'none' }
    );
  });
});

describe('the path shape', () => {
  it('accepts the www.github.com alias in the colon form', () => {
    assert.deepEqual(
      reviewTargetFromSegments(['www.github.com:oven-sh', 'bun', 'pull', '7']),
      { kind: 'github-pull', owner: 'oven-sh', repo: 'bun', number: 7 }
    );
  });

  it('splits a compare range at its first separator', () => {
    // Degenerate double separators read left to right, not three-dots-first.
    assert.deepEqual(
      reviewTargetFromSegments(['github.com:a', 'b', 'compare', 'a..b...c']),
      {
        kind: 'github-compare',
        owner: 'a',
        repo: 'b',
        base: 'a',
        head: 'b...c',
      }
    );
  });

  it('refuses a project segment that is exactly the marker', () => {
    assert.equal(
      reviewTargetFromSegments([
        'gitlab.com:g',
        '-',
        'r',
        '-',
        'merge_requests',
        '1',
      ]),
      undefined
    );
  });

  it('refuses a review number with a leading zero', () => {
    assert.equal(
      reviewTargetFromSegments(['github.com:a', 'b', 'pull', '007']),
      undefined
    );
  });
});
describe('reviewTargetSplat', () => {
  it('writes the canonical colon form for all six kinds', () => {
    assert.equal(
      reviewTargetSplat({
        kind: 'github-pull',
        owner: 'a',
        repo: 'b',
        number: 12,
      }),
      'github.com:a/b/pull/12'
    );
    assert.equal(
      reviewTargetSplat({
        kind: 'github-commit',
        owner: 'a',
        repo: 'b',
        sha: 'deadbeef',
      }),
      'github.com:a/b/commit/deadbeef'
    );
    assert.equal(
      reviewTargetSplat({
        kind: 'github-compare',
        owner: 'a',
        repo: 'b',
        base: 'main',
        head: 'topic',
      }),
      'github.com:a/b/compare/main...topic'
    );
    assert.equal(
      reviewTargetSplat({
        kind: 'gitlab-mr',
        host: 'gitlab.com',
        project: 'g/r',
        number: 12,
      }),
      'gitlab.com:g/r/-/merge_requests/12'
    );
    assert.equal(
      reviewTargetSplat({
        kind: 'gitlab-commit',
        host: 'gitlab.com',
        project: 'g/r',
        sha: 'deadbeef',
      }),
      'gitlab.com:g/r/-/commit/deadbeef'
    );
    assert.equal(
      reviewTargetSplat({
        kind: 'gitlab-compare',
        host: 'gitlab.com',
        project: 'g/r',
        base: 'main',
        head: 'topic',
      }),
      'gitlab.com:g/r/-/compare/main...topic'
    );
  });

  it('glues a host with a port as host:port:project', () => {
    assert.equal(
      reviewTargetSplat({
        kind: 'gitlab-mr',
        host: 'gitlab.corp.com:8443',
        project: 'g/r',
        number: 12,
      }),
      'gitlab.corp.com:8443:g/r/-/merge_requests/12'
    );
  });

  it('leaves a slash in a branch name alone', () => {
    assert.equal(
      reviewTargetSplat({
        kind: 'github-compare',
        owner: 'a',
        repo: 'b',
        base: 'main',
        head: 'renovate/all-minor',
      }),
      'github.com:a/b/compare/main...renovate/all-minor'
    );
  });
});

describe('round trips', () => {
  const targets = [
    { kind: 'github-pull', owner: 'a', repo: 'b', number: 12 },
    { kind: 'github-commit', owner: 'a', repo: 'b', sha: 'deadbeef' },
    {
      kind: 'github-compare',
      owner: 'a',
      repo: 'b',
      base: 'main',
      head: 'feature/x',
    },
    { kind: 'gitlab-mr', host: 'gitlab.com', project: 'g/r', number: 12 },
    {
      kind: 'gitlab-commit',
      host: 'gitlab.com',
      project: 'g/r',
      sha: 'deadbeef',
    },
    {
      kind: 'gitlab-compare',
      host: 'gitlab.com',
      project: 'g/r',
      base: 'main',
      head: 'feature/x',
    },
    {
      kind: 'gitlab-mr',
      host: 'gitlab.corp.com',
      project: 'g/s/r',
      number: 12,
    },
    {
      kind: 'gitlab-mr',
      host: 'gitlab.corp.com:8443',
      project: 'g/r',
      number: 12,
    },
  ] as const;

  for (const target of targets) {
    it(`survives the api query for ${target.kind}`, () => {
      assert.deepEqual(
        reviewTargetSearch.parse(Object.fromEntries(reviewTargetQuery(target))),
        target
      );
    });

    it(`produces a key and a label for ${target.kind}`, () => {
      assert.ok(reviewTargetKey(target).length > 0);
      assert.ok(describeReviewTarget(target).length > 0);
    });
  }

  // The router splits the splat on `/` and decodes each segment, so the splat
  // this app writes must survive `split('/')` with no decode step of its own.
  it('recovers a target from its own splat', () => {
    for (const target of targets) {
      assert.deepEqual(
        reviewTargetFromSegments(reviewTargetSplat(target).split('/')),
        target
      );
    }
  });

  it('names the host in every GitLab label', () => {
    assert.equal(
      describeReviewTarget({
        kind: 'gitlab-mr',
        host: 'gitlab.com',
        project: 'g/r',
        number: 12,
      }),
      'gitlab.com/g/r !12'
    );
    assert.equal(
      describeReviewTarget({
        kind: 'gitlab-mr',
        host: 'gitlab.corp.com',
        project: 'g/r',
        number: 12,
      }),
      'gitlab.corp.com/g/r !12'
    );
  });

  it('keeps the GitHub labels as they were', () => {
    assert.equal(
      describeReviewTarget({
        kind: 'github-pull',
        owner: 'a',
        repo: 'b',
        number: 1,
      }),
      'a/b #1'
    );
  });

  it('prefixes gitlab keys with the host', () => {
    assert.equal(
      reviewTargetKey({
        kind: 'gitlab-mr',
        host: 'gitlab.corp.com',
        project: 'g/r',
        number: 12,
      }),
      'gitlab:gitlab.corp.com:g/r#12'
    );
  });
});

describe('reviewTabTitle', () => {
  it('names a GitHub pull request with its title, place, and brand', () => {
    const target = {
      kind: 'github-pull' as const,
      owner: 'oven-sh',
      repo: 'bun',
      number: 30412,
    };
    assert.equal(
      reviewTabTitle(target, 'Fix the bug'),
      'Fix the bug · github.com/oven-sh/bun #30412 · ghdiff'
    );
    assert.equal(
      reviewTabTitle(target),
      'github.com/oven-sh/bun #30412 · ghdiff'
    );
  });

  it('marks a GitLab merge request with ! and names the host', () => {
    const target = {
      kind: 'gitlab-mr' as const,
      host: 'gitlab.corp.com:8443',
      project: 'group/sub/repo',
      number: 17,
    };
    assert.equal(
      reviewTabTitle(target, 'Add the thing'),
      'Add the thing · gitlab.corp.com:8443/group/sub/repo !17 · ghdiff'
    );
    assert.equal(
      reviewTabTitle(target),
      'gitlab.corp.com:8443/group/sub/repo !17 · ghdiff'
    );
  });

  it('names a commit and a compare range on either forge', () => {
    assert.equal(
      reviewTabTitle({
        kind: 'github-commit',
        owner: 'a',
        repo: 'b',
        sha: '0800fbaa12',
      }),
      'github.com/a/b @ 0800fba · ghdiff'
    );
    assert.equal(
      reviewTabTitle({
        kind: 'gitlab-commit',
        host: 'gitlab.com',
        project: 'g/r',
        sha: '0800fbaa12',
      }),
      'gitlab.com/g/r @ 0800fba · ghdiff'
    );
    assert.equal(
      reviewTabTitle({
        kind: 'github-compare',
        owner: 'a',
        repo: 'b',
        base: 'main',
        head: 'topic',
      }),
      'github.com/a/b main...topic · ghdiff'
    );
    assert.equal(
      reviewTabTitle({
        kind: 'gitlab-compare',
        host: 'gitlab.com',
        project: 'g/r',
        base: 'main',
        head: 'topic',
      }),
      'gitlab.com/g/r main...topic · ghdiff'
    );
  });
});

describe('reviewTabType', () => {
  it('maps the six target kinds to the three badge types', () => {
    assert.equal(
      reviewTabType({ kind: 'github-pull', owner: 'a', repo: 'b', number: 1 }),
      'pull'
    );
    assert.equal(
      reviewTabType({
        kind: 'gitlab-mr',
        host: 'gitlab.com',
        project: 'g/r',
        number: 1,
      }),
      'pull'
    );
    assert.equal(
      reviewTabType({
        kind: 'github-commit',
        owner: 'a',
        repo: 'b',
        sha: 'deadbeef',
      }),
      'commit'
    );
    assert.equal(
      reviewTabType({
        kind: 'gitlab-commit',
        host: 'gitlab.com',
        project: 'g/r',
        sha: 'deadbeef',
      }),
      'commit'
    );
    assert.equal(
      reviewTabType({
        kind: 'github-compare',
        owner: 'a',
        repo: 'b',
        base: 'x',
        head: 'y',
      }),
      'compare'
    );
    assert.equal(
      reviewTabType({
        kind: 'gitlab-compare',
        host: 'gitlab.com',
        project: 'g/r',
        base: 'x',
        head: 'y',
      }),
      'compare'
    );
  });
});

describe('segmentsFromPath', () => {
  it('strips a scheme, a leading slash, and empty segments', () => {
    assert.deepEqual(
      segmentsFromPath(
        ' https://gitlab.corp.com/group/repo/-/merge_requests/1 '
      ),
      ['gitlab.corp.com', 'group', 'repo', '-', 'merge_requests', '1']
    );
    assert.deepEqual(segmentsFromPath('/github.com:acme/app/pull/1'), [
      'github.com:acme',
      'app',
      'pull',
      '1',
    ]);
  });
});

describe('reviewTargetSearch', () => {
  const pull = {
    kind: 'github-pull',
    owner: 'octo',
    repo: 'hello',
    number: '7',
  };

  it('parses a target and lowercases the host', () => {
    assert.deepEqual(reviewTargetSearch.safeParse(pull).success, true);
    const parsed = reviewTargetSearch.parse({
      kind: 'gitlab-mr',
      host: 'GITLAB.CORP.COM',
      project: 'g/r',
      number: '12',
    });
    assert.deepEqual(parsed, {
      kind: 'gitlab-mr',
      host: 'gitlab.corp.com',
      project: 'g/r',
      number: 12,
    });
  });

  it('strips keys the target does not name', () => {
    const parsed = reviewTargetSearch.parse({ ...pull, extra: 'x' });
    assert.deepEqual(parsed, {
      kind: 'github-pull',
      owner: 'octo',
      repo: 'hello',
      number: 7,
    });
  });

  it('accepts an empty compare range, the tolerance the old parser had', () => {
    assert.equal(
      reviewTargetSearch.safeParse({
        kind: 'github-compare',
        owner: 'a',
        repo: 'b',
        base: '',
        head: '',
      }).success,
      true
    );
  });

  it('rejects a missing kind', () => {
    const { kind: _kind, ...rest } = pull;
    assert.equal(reviewTargetSearch.safeParse(rest).success, false);
  });

  it('rejects a kind the union does not know', () => {
    assert.equal(
      reviewTargetSearch.safeParse({ ...pull, kind: 'github-fork' }).success,
      false
    );
  });

  it('rejects a bad owner or repo', () => {
    for (const bad of [
      { ...pull, owner: 'has space' },
      { ...pull, repo: 'has/slash' },
      { ...pull, owner: '' },
    ]) {
      assert.equal(reviewTargetSearch.safeParse(bad).success, false);
    }
  });

  it('rejects a number that is not a positive integer', () => {
    for (const number of ['abc', '3.5', '0', '-2']) {
      assert.equal(
        reviewTargetSearch.safeParse({ ...pull, number }).success,
        false
      );
    }
  });

  it('rejects a bad host', () => {
    for (const host of ['not a host', 'gitlab.com:abc', 'gitlab.com:8:9', '']) {
      assert.equal(
        reviewTargetSearch.safeParse({
          kind: 'gitlab-mr',
          host,
          project: 'g/r',
          number: '1',
        }).success,
        false
      );
    }
  });

  it('rejects a bad project shape', () => {
    for (const project of ['', 'g//r', '/g/r', 'g/r/', 'g r']) {
      assert.equal(
        reviewTargetSearch.safeParse({
          kind: 'gitlab-mr',
          host: 'gitlab.com',
          project,
          number: '1',
        }).success,
        false
      );
    }
  });
});

describe('a local diff target', () => {
  const SHA = '8c20a53d3b1c0a2e9f4b6d7c8e1f2a3b4c5d6e7f';
  const worktree: LocalDiffTarget = {
    kind: 'local-diff',
    root: '/home/dev/projects/ghdiff',
    range: { mode: 'worktree' },
  };

  it('is not a forge target, and the others are', () => {
    assert.equal(isForgeTarget(worktree), false);
    assert.equal(
      isForgeTarget({
        kind: 'github-commit',
        owner: 'a',
        repo: 'b',
        sha: 'deadbeef',
      }),
      true
    );
  });

  it('keeps its comments in the browser, like a commit', () => {
    assert.equal(pullRefFromTarget(worktree), undefined);
  });

  it('keys off the repository path and the range, and off nothing else', () => {
    // The port and the token are new on every run of the command, so neither
    // may reach this string: a reviewer's comments have to survive a Ctrl-C.
    assert.equal(
      reviewTargetKey(worktree),
      'local:/home/dev/projects/ghdiff:working tree'
    );
    assert.equal(
      reviewTargetKey({ ...worktree, range: { mode: 'staged' } }),
      'local:/home/dev/projects/ghdiff:staged'
    );
    assert.equal(
      reviewTargetKey({ ...worktree, range: { mode: 'branch', base: 'main' } }),
      'local:/home/dev/projects/ghdiff:main...HEAD'
    );
    assert.equal(
      reviewTargetKey({
        ...worktree,
        range: { mode: 'range', base: 'main', head: 'topic' },
      }),
      'local:/home/dev/projects/ghdiff:main...topic'
    );
    // The whole sha: the command pinned HEAD to one at launch so that the next
    // commit cannot inherit this one's notes.
    assert.equal(
      reviewTargetKey({
        ...worktree,
        range: { mode: 'commit', rev: SHA },
      }),
      `local:/home/dev/projects/ghdiff:commit ${SHA}`
    );
  });

  it('names the repository by its directory', () => {
    assert.equal(describeReviewTarget(worktree), 'ghdiff \u00b7 working tree');
    assert.equal(
      describeReviewTarget({
        ...worktree,
        range: { mode: 'range', base: 'main', head: 'topic' },
      }),
      'ghdiff \u00b7 main...topic'
    );
    assert.equal(
      describeReviewTarget({
        ...worktree,
        range: { mode: 'commit', rev: SHA },
      }),
      'ghdiff \u00b7 commit 8c20a53'
    );
  });

  it('cuts every sha in a range label and leaves a name whole', () => {
    const other = 'b4d725ba5827f10bcd032f16eff3053a980c2ebc';
    assert.equal(
      describeReviewTarget({
        ...worktree,
        range: { mode: 'range', base: SHA, head: other },
      }),
      'ghdiff \u00b7 8c20a53...b4d725b'
    );
    assert.equal(
      describeReviewTarget({
        ...worktree,
        range: { mode: 'branch', base: SHA },
      }),
      'ghdiff \u00b7 8c20a53...HEAD'
    );
    assert.equal(
      describeReviewTarget({
        kind: 'github-compare',
        owner: 'o',
        repo: 'r',
        base: 'main',
        head: other,
      }),
      'o/r main...b4d725b'
    );
  });

  it('survives the trip through the query', () => {
    for (const range of [
      { mode: 'worktree' },
      { mode: 'staged' },
      { mode: 'branch', base: 'main' },
      { mode: 'range', base: 'main', head: 'topic' },
      { mode: 'commit', rev: SHA },
    ] as const) {
      const target: LocalDiffTarget = { ...worktree, range };
      assert.deepEqual(
        reviewTargetFromQuery(reviewTargetQuery(target)),
        target
      );
    }
  });

  it('refuses a query missing the part its mode needs', () => {
    assert.equal(
      reviewTargetFromQuery(
        new URLSearchParams({ kind: 'local-diff', root: '/r', mode: 'branch' })
      ),
      undefined
    );
    assert.equal(
      reviewTargetFromQuery(
        new URLSearchParams({
          kind: 'local-diff',
          root: '/r',
          mode: 'range',
          base: 'main',
        })
      ),
      undefined
    );
    assert.equal(
      reviewTargetFromQuery(
        new URLSearchParams({ kind: 'local-diff', mode: 'worktree' })
      ),
      undefined
    );
    assert.equal(
      reviewTargetFromQuery(
        new URLSearchParams({ kind: 'local-diff', root: '/r', mode: 'tree' })
      ),
      undefined
    );
    assert.equal(
      reviewTargetFromQuery(
        new URLSearchParams({ kind: 'local-diff', root: '/r', mode: 'commit' })
      ),
      undefined
    );
  });

  it('never comes out of a review path', () => {
    assert.equal(reviewTargetFromSegments(['local-diff']), undefined);
    assert.equal(
      reviewTargetFromSegments(segmentsFromPath('/home/dev/projects/ghdiff')),
      undefined
    );
  });
});

describe('repoNameFromRoot', () => {
  it('takes the last segment, on either separator', () => {
    assert.equal(repoNameFromRoot('/home/dev/ghdiff'), 'ghdiff');
    assert.equal(repoNameFromRoot('/home/dev/ghdiff/'), 'ghdiff');
    assert.equal(repoNameFromRoot('C:\\Users\\dev\\ghdiff'), 'ghdiff');
  });

  it('answers with the root itself when there is no segment to take', () => {
    assert.equal(repoNameFromRoot('/'), '/');
  });
});

describe('parseCompareRange', () => {
  // The `ghdiff` command reads its own `base..head` argument through this, so
  // a range typed at a terminal and one pasted out of a compare URL are split
  // by one function rather than by two that could come to disagree.
  it('splits on the first separator, and prefers the three-dot one', () => {
    assert.deepEqual(parseCompareRange('main...feature'), {
      base: 'main',
      head: 'feature',
    });
    assert.deepEqual(parseCompareRange('main..feature'), {
      base: 'main',
      head: 'feature',
    });
  });

  it('is not a range when either side is missing', () => {
    assert.equal(parseCompareRange('main'), undefined);
    assert.equal(parseCompareRange('..feature'), undefined);
    assert.equal(parseCompareRange('main..'), undefined);
  });
});
