import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  describeReviewTarget,
  gitHubTargetFromSegments,
  parseGitHubInput,
  reviewTargetFromQuery,
  reviewTargetKey,
  reviewTargetDisplayPath,
  reviewTargetQuery,
  reviewTargetSplat,
  supportsGitHubComments,
} from './reviewTarget.ts';

describe('parseGitHubInput', () => {
  it('parses a pull request URL', () => {
    assert.deepEqual(
      parseGitHubInput('https://github.com/oven-sh/bun/pull/30412'),
      {
        kind: 'github-pull',
        owner: 'oven-sh',
        repo: 'bun',
        number: 30412,
      }
    );
  });

  it('parses a pull request files tab', () => {
    assert.deepEqual(
      parseGitHubInput('https://github.com/oven-sh/bun/pull/30412/files'),
      { kind: 'github-pull', owner: 'oven-sh', repo: 'bun', number: 30412 }
    );
  });

  it('parses a raw patch URL', () => {
    assert.deepEqual(
      parseGitHubInput('https://github.com/oven-sh/bun/pull/30412.diff'),
      { kind: 'github-pull', owner: 'oven-sh', repo: 'bun', number: 30412 }
    );
  });

  it('parses the owner/repo#number shorthand', () => {
    assert.deepEqual(parseGitHubInput('GalvinGao/ghdiff#7'), {
      kind: 'github-pull',
      owner: 'GalvinGao',
      repo: 'ghdiff',
      number: 7,
    });
  });

  it('parses a commit URL', () => {
    assert.deepEqual(
      parseGitHubInput('github.com/pierrecomputer/pierre/commit/0800fbaa'),
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
      parseGitHubInput('https://github.com/torvalds/linux/compare/v6.0...v6.1'),
      {
        kind: 'github-compare',
        owner: 'torvalds',
        repo: 'linux',
        base: 'v6.0',
        head: 'v6.1',
      }
    );
  });

  it('rejects a host that is not github.com', () => {
    assert.equal(parseGitHubInput('https://gitlab.com/a/b/pull/1'), undefined);
  });

  it('rejects text that is not a target', () => {
    assert.equal(parseGitHubInput(''), undefined);
    assert.equal(parseGitHubInput('hello world'), undefined);
    assert.equal(parseGitHubInput('https://github.com/oven-sh/bun'), undefined);
  });
});

describe('gitHubTargetFromSegments', () => {
  it('rejects a pull number that is not a positive integer', () => {
    assert.equal(gitHubTargetFromSegments(['a', 'b', 'pull', '0']), undefined);
    assert.equal(gitHubTargetFromSegments(['a', 'b', 'pull', 'x']), undefined);
  });

  it('rejects a sha that is too short', () => {
    assert.equal(
      gitHubTargetFromSegments(['a', 'b', 'commit', 'abc']),
      undefined
    );
  });

  it('accepts a percent-encoded compare range', () => {
    assert.deepEqual(
      gitHubTargetFromSegments([
        'a',
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
  ] as const;

  for (const target of targets) {
    it(`survives the api query for ${target.kind}`, () => {
      assert.deepEqual(
        reviewTargetFromQuery(reviewTargetQuery(target)),
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
  it('recovers a github target from its own splat', () => {
    for (const target of targets) {
      assert.deepEqual(
        gitHubTargetFromSegments(reviewTargetSplat(target).split('/')),
        target
      );
    }
  });

  it('shortens a commit SHA for display and leaves the rest alone', () => {
    assert.equal(
      reviewTargetDisplayPath({
        kind: 'github-commit',
        owner: 'gekichumai',
        repo: 'dxrating',
        sha: '637a9c80f69d3222d1c3aed3ae8f4aefdb613bc9',
      }),
      'gekichumai/dxrating/commit/637a9c8'
    );
    assert.equal(
      reviewTargetDisplayPath({
        kind: 'github-pull',
        owner: 'oven-sh',
        repo: 'bun',
        number: 30412,
      }),
      'oven-sh/bun/pull/30412'
    );
    assert.equal(
      reviewTargetDisplayPath({
        kind: 'github-compare',
        owner: 'ghostty-org',
        repo: 'ghostty',
        base: 'v1.3.0',
        head: 'v1.3.1',
      }),
      'ghostty-org/ghostty/compare/v1.3.0...v1.3.1'
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
      'a/b/compare/main...renovate/all-minor'
    );
  });

  it('keeps a branch name that holds a percent sign', () => {
    assert.deepEqual(
      gitHubTargetFromSegments(['a', 'b', 'compare', 'main...fix-100%']),
      {
        kind: 'github-compare',
        owner: 'a',
        repo: 'b',
        base: 'main',
        head: 'fix-100%',
      }
    );
  });
});

describe('supportsGitHubComments', () => {
  it('is true only for a pull request', () => {
    assert.equal(
      supportsGitHubComments({
        kind: 'github-pull',
        owner: 'a',
        repo: 'b',
        number: 1,
      }),
      true
    );
    assert.equal(
      supportsGitHubComments({
        kind: 'github-commit',
        owner: 'a',
        repo: 'b',
        sha: 'deadbeef',
      }),
      false
    );
    assert.equal(
      supportsGitHubComments({
        kind: 'github-compare',
        owner: 'a',
        repo: 'b',
        base: 'main',
        head: 'topic',
      }),
      false
    );
  });
});
