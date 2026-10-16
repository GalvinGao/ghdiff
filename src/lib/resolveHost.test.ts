import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { resolveOutcome, reviewInputFrom } from './resolveHost';

/** A deployment serving gitlab.com and one self-hosted instance, on a port. */
const HOSTS = ['gitlab.com', 'gitlab.corp.com:8443'];
const OWN_HOST = 'ghdiff.com';

/** The target an input parses to, or undefined when it parses to none. */
function targetOf(
  input: string,
  gitlabHosts: readonly string[] = HOSTS,
  ownHost?: string
) {
  const result = reviewInputFrom(input, { gitlabHosts, ownHost });
  return result.kind === 'target' ? result.target : undefined;
}

/** The hostless answer an input parses to, or undefined for anything else. */
function hostlessOf(input: string, ownHost?: string) {
  const result = reviewInputFrom(input, {
    gitlabHosts: HOSTS,
    ownHost,
  });
  return result.kind === 'hostless' ? result : undefined;
}

describe('reviewInputFrom', () => {
  it('parses a pull request URL on any deployment', () => {
    const expected = {
      kind: 'github-pull',
      owner: 'oven-sh',
      repo: 'bun',
      number: 30412,
    };
    assert.deepEqual(
      targetOf('https://github.com/oven-sh/bun/pull/30412', []),
      expected
    );
    assert.deepEqual(
      targetOf('https://github.com/oven-sh/bun/pull/30412'),
      expected
    );
  });

  it('parses a pull request files tab', () => {
    assert.deepEqual(
      targetOf('https://github.com/oven-sh/bun/pull/30412/files', []),
      { kind: 'github-pull', owner: 'oven-sh', repo: 'bun', number: 30412 }
    );
  });

  it('parses a raw patch URL', () => {
    assert.deepEqual(
      targetOf('https://github.com/oven-sh/bun/pull/30412.diff', []),
      { kind: 'github-pull', owner: 'oven-sh', repo: 'bun', number: 30412 }
    );
  });

  it('parses a commit URL', () => {
    assert.deepEqual(
      targetOf('github.com/pierrecomputer/pierre/commit/0800fbaa', []),
      {
        kind: 'github-commit',
        owner: 'pierrecomputer',
        repo: 'pierre',
        sha: '0800fbaa',
      }
    );
  });

  it('parses a compare URL', () => {
    assert.deepEqual(
      targetOf('https://github.com/torvalds/linux/compare/v6.0...v6.1', []),
      {
        kind: 'github-compare',
        owner: 'torvalds',
        repo: 'linux',
        base: 'v6.0',
        head: 'v6.1',
      }
    );
  });

  it('parses a merge request URL on a configured host', () => {
    assert.deepEqual(
      targetOf('https://gitlab.com/gitlab-org/gitlab/-/merge_requests/17'),
      {
        kind: 'gitlab-mr',
        host: 'gitlab.com',
        project: 'gitlab-org/gitlab',
        number: 17,
      }
    );
  });

  it('parses a self-hosted merge request URL, port kept', () => {
    assert.deepEqual(
      targetOf('https://gitlab.corp.com:8443/team/sub/repo/-/merge_requests/3'),
      {
        kind: 'gitlab-mr',
        host: 'gitlab.corp.com:8443',
        project: 'team/sub/repo',
        number: 3,
      }
    );
  });

  it('parses self-hosted commit and compare URLs', () => {
    assert.deepEqual(
      targetOf('https://gitlab.corp.com:8443/team/repo/-/commit/0800fbaa'),
      {
        kind: 'gitlab-commit',
        host: 'gitlab.corp.com:8443',
        project: 'team/repo',
        sha: '0800fbaa',
      }
    );
    assert.deepEqual(
      targetOf('https://gitlab.com/team/repo/-/compare/v1.0...v1.1'),
      {
        kind: 'gitlab-compare',
        host: 'gitlab.com',
        project: 'team/repo',
        base: 'v1.0',
        head: 'v1.1',
      }
    );
  });

  it('matches the configured hosts case-insensitively', () => {
    assert.deepEqual(
      targetOf('https://gitlab.com/g/r/-/merge_requests/1', ['GITLAB.com']),
      { kind: 'gitlab-mr', host: 'gitlab.com', project: 'g/r', number: 1 }
    );
  });

  it('rejects a GitLab host the deployment does not serve', () => {
    assert.equal(
      targetOf('https://gitlab.example.com/g/r/-/merge_requests/1', []),
      undefined
    );
    assert.equal(
      targetOf('https://gitlab.example.com/g/r/-/merge_requests/1'),
      undefined
    );
    assert.equal(
      targetOf('https://gitlab.com/g/r/-/merge_requests/1', []),
      undefined
    );
  });

  it('reads owner/repo#123 as a GitHub pull request', () => {
    assert.deepEqual(targetOf('GalvinGao/ghdiff#7'), {
      kind: 'github-pull',
      owner: 'GalvinGao',
      repo: 'ghdiff',
      number: 7,
    });
  });

  it('reads a nested shorthand as no target rather than guessing a host', () => {
    // A deeper path would nest the way a GitLab project does, but the
    // shorthand names no host, and this parser does not guess one — the
    // resolve endpoint's probe is what answers a hostless path.
    assert.equal(targetOf('group/sub/repo#7'), undefined);
    assert.equal(targetOf('group/sub/repo#7', []), undefined);
  });

  it('rejects a github.com URL carrying GitLab’s separator', () => {
    assert.equal(
      targetOf('https://github.com/g/r/-/merge_requests/1'),
      undefined
    );
  });

  it('rejects a GitLab URL in github.com shape', () => {
    assert.equal(targetOf('https://gitlab.com/a/b/pull/1'), undefined);
  });

  it('keeps a tab-named segment inside a nested GitLab project path', () => {
    assert.deepEqual(
      targetOf('https://gitlab.com/a/b/c/d/diffs/-/merge_requests/1'),
      {
        kind: 'gitlab-mr',
        host: 'gitlab.com',
        project: 'a/b/c/d/diffs',
        number: 1,
      }
    );
  });

  it('strips a trailing tab segment from a merge request URL', () => {
    assert.deepEqual(
      targetOf('https://gitlab.com/a/b/c/d/-/merge_requests/1/diffs'),
      {
        kind: 'gitlab-mr',
        host: 'gitlab.com',
        project: 'a/b/c/d',
        number: 1,
      }
    );
  });

  it('rejects text that is not a target', () => {
    assert.equal(targetOf(''), undefined);
    assert.equal(targetOf('hello world'), undefined);
    assert.equal(targetOf('https://github.com/oven-sh/bun', []), undefined);
  });

  it('reads the bare colon form as a target, membership unchecked', () => {
    assert.deepEqual(targetOf('github.com:oven-sh/bun/pull/7'), {
      kind: 'github-pull',
      owner: 'oven-sh',
      repo: 'bun',
      number: 7,
    });
    assert.deepEqual(
      targetOf('gitlab.corp.com:8443:group/repo/-/merge_requests/3'),
      {
        kind: 'gitlab-mr',
        host: 'gitlab.corp.com:8443',
        project: 'group/repo',
        number: 3,
      }
    );
  });

  it('reads a complete ghdiff URL from its pathname', () => {
    assert.deepEqual(
      targetOf(
        'https://ghdiff.com/github.com:oven-sh/bun/pull/7',
        HOSTS,
        OWN_HOST
      ),
      { kind: 'github-pull', owner: 'oven-sh', repo: 'bun', number: 7 }
    );
    assert.deepEqual(
      targetOf(
        'https://ghdiff.com/gitlab.com:group/repo/-/merge_requests/3',
        HOSTS,
        OWN_HOST
      ),
      {
        kind: 'gitlab-mr',
        host: 'gitlab.com',
        project: 'group/repo',
        number: 3,
      }
    );
  });

  it('reads a bare GitLab path as the resolve endpoint’s input', () => {
    assert.deepEqual(hostlessOf('group/repo/-/merge_requests/1'), {
      kind: 'hostless',
      path: 'group/repo/-/merge_requests/1',
    });
    assert.deepEqual(hostlessOf('group/sub/repo/-/compare/v1.0...v1.1'), {
      kind: 'hostless',
      path: 'group/sub/repo/-/compare/v1.0...v1.1',
    });
  });

  it('splits a fragment off the input to travel beside the path', () => {
    assert.deepEqual(
      hostlessOf('group/repo/-/merge_requests/1#diff-src/a.ts'),
      {
        kind: 'hostless',
        path: 'group/repo/-/merge_requests/1',
        hash: 'diff-src/a.ts',
      }
    );
    // An empty fragment names nothing and is dropped.
    assert.deepEqual(hostlessOf('group/repo/-/merge_requests/1#'), {
      kind: 'hostless',
      path: 'group/repo/-/merge_requests/1',
    });
  });

  it('reads a pasted ghdiff URL from its pathname', () => {
    assert.deepEqual(
      hostlessOf('https://ghdiff.com/group/repo/-/merge_requests/1', OWN_HOST),
      { kind: 'hostless', path: 'group/repo/-/merge_requests/1' }
    );
    assert.deepEqual(
      hostlessOf(
        'https://ghdiff.com/group/repo/-/merge_requests/1#diff-src/a.ts',
        OWN_HOST
      ),
      {
        kind: 'hostless',
        path: 'group/repo/-/merge_requests/1',
        hash: 'diff-src/a.ts',
      }
    );
    // The host matches without case, and with a port kept.
    assert.deepEqual(
      hostlessOf('https://GHDIFF.com/group/repo/-/merge_requests/1', OWN_HOST),
      { kind: 'hostless', path: 'group/repo/-/merge_requests/1' }
    );
    assert.deepEqual(
      hostlessOf(
        'https://localhost:3000/group/repo/-/merge_requests/1',
        'localhost:3000'
      ),
      { kind: 'hostless', path: 'group/repo/-/merge_requests/1' }
    );
  });

  it('reads no other complete URL as hostless', () => {
    // A forge URL is a target of its own when the host is served, and the
    // rejected-host sentence's to answer when it is not — never a resolve
    // input.
    assert.equal(
      hostlessOf('https://gitlab.com/group/repo/-/merge_requests/1', OWN_HOST),
      undefined
    );
    assert.equal(
      hostlessOf(
        'https://ghdiff.com/gitlab.com:g/r/-/merge_requests/1',
        OWN_HOST
      ),
      undefined
    );
    // And with no own host named, no complete URL is hostless.
    assert.equal(
      hostlessOf('https://ghdiff.com/group/repo/-/merge_requests/1'),
      undefined
    );
  });

  it('refuses an input whose first segment is a host', () => {
    // A scheme-less first segment that is a hostname is the legacy form, and
    // a configured one parses as a target outright.
    assert.equal(hostlessOf('gitlab.com/g/r/-/merge_requests/1'), undefined);
    // The canonical colon form is not hostless either.
    assert.equal(hostlessOf('gitlab.com:g/r/-/merge_requests/1'), undefined);
  });

  it('keeps a dotted group with less than a group and a project behind it', () => {
    // A dotted head with a full legacy shape behind it is the legacy form;
    // a dotted head with less behind it is a bare path whose group happens
    // to carry a dot, and resolving it is the whole point.
    assert.deepEqual(hostlessOf('that.group/repo/-/merge_requests/1'), {
      kind: 'hostless',
      path: 'that.group/repo/-/merge_requests/1',
    });
  });

  it('refuses a path with no GitLab shape', () => {
    assert.equal(hostlessOf('group/repo'), undefined);
    assert.equal(hostlessOf('-/merge_requests/1'), undefined);
    assert.equal(hostlessOf('owner/repo#123'), undefined);
  });
});

describe('resolveOutcome', () => {
  it('reads the canonical path out of a 200’s body', () => {
    assert.deepEqual(
      resolveOutcome(
        200,
        new Headers({ 'content-type': 'text/plain' }),
        '/gitlab.com:group/repo/-/merge_requests/1'
      ),
      {
        kind: 'resolved',
        splat: 'gitlab.com:group/repo/-/merge_requests/1',
      }
    );
  });

  it('strips exactly one leading slash from the body', () => {
    assert.deepEqual(
      resolveOutcome(
        200,
        new Headers(),
        '\n/gitlab.com:g/r/-/commit/0800fbaa\n'
      ),
      { kind: 'resolved', splat: 'gitlab.com:g/r/-/commit/0800fbaa' }
    );
  });

  it('reads a 200 body that is no canonical path as a failure', () => {
    for (const body of [
      '',
      '/',
      'gitlab.com:g/r/-/merge_requests/1',
      '  \n ',
    ]) {
      const outcome = resolveOutcome(200, new Headers(), body);
      assert.equal(outcome.kind, 'failed');
      assert.equal(outcome.kind === 'failed' && outcome.failure, null);
      assert.match(
        outcome.kind === 'failed' ? outcome.message : '',
        /could not be resolved/
      );
    }
  });

  it('reads the typed failure and the sentence off a 400, 401 or 404', () => {
    assert.deepEqual(
      resolveOutcome(
        400,
        new Headers({ 'x-ghdiff-failure': 'bad-request' }),
        'That address is not a GitLab one.'
      ),
      {
        kind: 'failed',
        failure: { reason: 'bad-request' },
        message: 'That address is not a GitLab one.',
      }
    );
    assert.deepEqual(
      resolveOutcome(
        401,
        new Headers({ 'x-ghdiff-failure': 'auth-expired' }),
        'Your sign-in is no longer valid.'
      ),
      {
        kind: 'failed',
        failure: { reason: 'auth-expired' },
        message: 'Your sign-in is no longer valid.',
      }
    );
    assert.deepEqual(
      resolveOutcome(
        404,
        new Headers({ 'x-ghdiff-failure': 'not-served' }),
        'no GitLab hosts'
      ),
      {
        kind: 'failed',
        failure: { reason: 'not-served' },
        message: 'no GitLab hosts',
      }
    );
    assert.deepEqual(
      resolveOutcome(
        404,
        new Headers({
          'x-ghdiff-failure': 'not-found',
          'x-ghdiff-forge': 'gitlab',
          'x-ghdiff-host': 'gitlab.com',
        }),
        'No GitLab host shows that project.'
      ),
      {
        kind: 'failed',
        failure: { reason: 'not-found', forge: 'gitlab', host: 'gitlab.com' },
        message: 'No GitLab host shows that project.',
      }
    );
  });

  it('answers no failure for any other status, header or not', () => {
    const withHeader = resolveOutcome(
      500,
      new Headers({ 'x-ghdiff-failure': 'not-found' }),
      'the server’s own sentence'
    );
    assert.deepEqual(withHeader, {
      kind: 'failed',
      failure: null,
      message: 'the server’s own sentence',
    });
    const withoutBody = resolveOutcome(502, new Headers(), '');
    assert.equal(withoutBody.kind, 'failed');
    assert.equal(withoutBody.kind === 'failed' && withoutBody.failure, null);
    assert.match(
      withoutBody.kind === 'failed' ? withoutBody.message : '',
      /could not be resolved/
    );
  });
});
