import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { reviewTargetUrl } from './githubUrls.ts';
import {
  acceptReviewedCommits,
  commitNeighbors,
  pullCommitDiffTarget,
  reviewedCommitCount,
  type PullCommit,
} from './pullCommits.ts';
import {
  parseGitHubInput,
  reviewTargetFromQuery,
  reviewTargetKey,
  reviewTargetQuery,
  reviewTargetSplat,
  gitHubTargetFromSegments,
} from './reviewTarget.ts';

const a = 'a'.repeat(40);
const b = 'b'.repeat(40);
const c = 'c'.repeat(40);
const pull = {
  kind: 'github-pull',
  owner: 'owner',
  repo: 'repo',
  number: 7,
} as const;
const commits: PullCommit[] = [a, b, c].map((sha, i) => ({
  sha,
  parents: i === 0 ? [] : [i === 1 ? a : b],
  message: 'Change',
  author: 'author',
}));

describe('PR commit targets', () => {
  it('round trips a complete SHA through the URL, input box and API', () => {
    const target = { ...pull, commitSha: a };
    const url = reviewTargetUrl(target);
    assert.deepEqual(parseGitHubInput(url), target);
    assert.deepEqual(
      gitHubTargetFromSegments(reviewTargetSplat(target).split('/')),
      target
    );
    assert.deepEqual(reviewTargetFromQuery(reviewTargetQuery(target)), target);
    assert.deepEqual(
      parseGitHubInput(url.replace('/commits/', '/changes/')),
      target
    );
    assert.notEqual(reviewTargetKey(target), reviewTargetKey(pull));
    assert.notEqual(
      reviewTargetKey(target),
      reviewTargetKey({
        kind: 'github-commit',
        owner: pull.owner,
        repo: pull.repo,
        sha: a,
      })
    );
  });
  it('rejects malformed or abbreviated selected SHAs without opening the overall diff', () => {
    for (const sha of ['a'.repeat(7), 'x'.repeat(40), '', a + '/extra']) {
      assert.equal(
        gitHubTargetFromSegments(`owner/repo/pull/7/commits/${sha}`.split('/')),
        undefined
      );
    }
    const query = reviewTargetQuery(pull);
    query.set('commitSha', 'bad');
    assert.equal(reviewTargetFromQuery(query), undefined);
  });
  it('keeps the ordinary PR tabs as All changes', () => {
    for (const tab of ['', '/files', '/changes', '/commits'])
      assert.deepEqual(
        parseGitHubInput(`https://github.com/owner/repo/pull/7${tab}`),
        pull
      );
  });
});

describe('commit review navigation and progress', () => {
  it('does not wrap or skip completed commits', () => {
    assert.equal(commitNeighbors(commits, a).previous, undefined);
    assert.equal(commitNeighbors(commits, a).next?.sha, b);
    assert.equal(commitNeighbors(commits, c).next, undefined);
    assert.equal(commitNeighbors(commits, 'missing').index, -1);
  });
  it('counts only SHAs still in the PR and refuses corrupt browser data', () => {
    assert.deepEqual(acceptReviewedCommits([a, a, 'bad', null, 42]), [a]);
    assert.deepEqual(acceptReviewedCommits({ [a]: true }), []);
    const reviewed = new Set([a, b]);
    assert.equal(reviewedCommitCount(commits, reviewed), 2);
    assert.equal(reviewedCommitCount([commits[2]], reviewed), 0);
    reviewed.delete(a);
    assert.equal(reviewedCommitCount(commits, reviewed), 1);
  });
  it('compares against the first parent, including merges, and supports root commits', () => {
    assert.deepEqual(pullCommitDiffTarget(pull, commits[0]), {
      kind: 'github-commit',
      owner: 'owner',
      repo: 'repo',
      sha: a,
    });
    assert.deepEqual(
      pullCommitDiffTarget(pull, { ...commits[2], parents: [b, a] }),
      { kind: 'github-compare', owner: 'owner', repo: 'repo', base: b, head: c }
    );
    assert.equal(pullCommitDiffTarget(pull, commits[1]).kind, 'github-compare');
  });
});
