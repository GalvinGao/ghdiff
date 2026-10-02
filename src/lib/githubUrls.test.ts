import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  accountAvatarUrl,
  blobPermalinkUrl,
  commitUrl,
  repoPullsUrl,
  repoUrl,
  reviewTargetUrl,
} from './githubUrls.ts';

const REF = { owner: 'acme', repo: 'app' };

describe('accountAvatarUrl', () => {
  it('is the login with .png and a size', () => {
    assert.equal(
      accountAvatarUrl('acme', 32),
      'https://github.com/acme.png?size=32'
    );
  });
});

describe('repoUrl', () => {
  it('is the repository page', () => {
    assert.equal(repoUrl(REF), 'https://github.com/acme/app');
  });
});

describe('commitUrl', () => {
  it('is the commit page', () => {
    assert.equal(
      commitUrl(REF, '6e21af4c1d'),
      'https://github.com/acme/app/commit/6e21af4c1d'
    );
  });
});

describe('repoPullsUrl', () => {
  it('carries the same query GitHub applies to its own tab', () => {
    assert.equal(
      repoPullsUrl(REF),
      'https://github.com/acme/app/pulls?q=is%3Apr+is%3Aopen'
    );
  });

  it('narrows to one author', () => {
    assert.equal(
      repoPullsUrl(REF, { author: 'GalvinGao' }),
      'https://github.com/acme/app/pulls?q=is%3Apr+is%3Aopen+author%3AGalvinGao'
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
      'https://github.com/acme/app/pull/594'
    );
  });

  it('answers for a commit', () => {
    assert.equal(
      reviewTargetUrl({ kind: 'github-commit', ...REF, sha: '637a9c8' }),
      'https://github.com/acme/app/commit/637a9c8'
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
      'https://github.com/acme/app/compare/v1.3.0...v1.3.1'
    );
  });
});

describe('blobPermalinkUrl', () => {
  const SHA = 'a'.repeat(40);

  it('anchors one line', () => {
    assert.equal(
      blobPermalinkUrl(REF, SHA, 'src/a.ts', { start: 4, end: 4 }),
      `https://github.com/acme/app/blob/${SHA}/src/a.ts#L4`
    );
  });

  it('anchors a range in order, whichever way it was dragged', () => {
    assert.equal(
      blobPermalinkUrl(REF, SHA, 'src/a.ts', { start: 9, end: 3 }),
      `https://github.com/acme/app/blob/${SHA}/src/a.ts#L3-L9`
    );
  });

  it('asks a rendered document for its source', () => {
    assert.equal(
      blobPermalinkUrl(REF, SHA, 'docs/README.md', { start: 1, end: 2 }),
      `https://github.com/acme/app/blob/${SHA}/docs/README.md?plain=1#L1-L2`
    );
  });

  it('escapes each segment and keeps the slashes', () => {
    assert.equal(
      blobPermalinkUrl(REF, SHA, 'a b/#c.ts', { start: 1, end: 1 }),
      `https://github.com/acme/app/blob/${SHA}/a%20b/%23c.ts#L1`
    );
  });
});
