import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  commitUrl,
  repoPullsUrl,
  repoUrl,
  reviewTargetUrl,
} from './githubUrls.ts';

const REF = { owner: 'troph-team', repo: 'lilja' };

describe('repoUrl', () => {
  it('is the repository page', () => {
    assert.equal(repoUrl(REF), 'https://github.com/troph-team/lilja');
  });
});

describe('commitUrl', () => {
  it('is the commit page', () => {
    assert.equal(
      commitUrl(REF, '6e21af4c1d'),
      'https://github.com/troph-team/lilja/commit/6e21af4c1d'
    );
  });
});

describe('repoPullsUrl', () => {
  it('carries the same query GitHub applies to its own tab', () => {
    assert.equal(
      repoPullsUrl(REF),
      'https://github.com/troph-team/lilja/pulls?q=is%3Apr+is%3Aopen'
    );
  });

  it('narrows to one author', () => {
    assert.equal(
      repoPullsUrl(REF, { author: 'GalvinGao' }),
      'https://github.com/troph-team/lilja/pulls?q=is%3Apr+is%3Aopen+author%3AGalvinGao'
    );
  });

  it('ignores an author that is not there', () => {
    assert.equal(repoPullsUrl(REF, { author: '' }), repoPullsUrl(REF));
    assert.equal(repoPullsUrl(REF, {}), repoPullsUrl(REF));
  });
});

describe('reviewTargetUrl', () => {
  it('answers for a pull request', () => {
    assert.equal(
      reviewTargetUrl({ kind: 'github-pull', ...REF, number: 594 }),
      'https://github.com/troph-team/lilja/pull/594'
    );
  });

  it('answers for a commit', () => {
    assert.equal(
      reviewTargetUrl({ kind: 'github-commit', ...REF, sha: '637a9c8' }),
      'https://github.com/troph-team/lilja/commit/637a9c8'
    );
  });

  it('answers for a compare range', () => {
    assert.equal(
      reviewTargetUrl({
        kind: 'github-compare',
        ...REF,
        base: 'v1.3.0',
        head: 'v1.3.1',
      }),
      'https://github.com/troph-team/lilja/compare/v1.3.0...v1.3.1'
    );
  });
});
