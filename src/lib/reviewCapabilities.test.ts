import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { reviewCapabilities } from './forges';

describe('reviewCapabilities', () => {
  it('gives a pull request the forge comment store', () => {
    assert.equal(
      reviewCapabilities({
        kind: 'github-pull',
        owner: 'o',
        repo: 'r',
        number: 1,
      }).commentStore,
      'forge'
    );
  });

  it('keeps commits and compare ranges browser-local', () => {
    for (const target of [
      { kind: 'github-commit', owner: 'o', repo: 'r', sha: '0800fbaa' },
      { kind: 'github-compare', owner: 'o', repo: 'r', base: 'v1', head: 'v2' },
    ] as const) {
      assert.equal(reviewCapabilities(target).commentStore, 'local');
    }
  });
});
