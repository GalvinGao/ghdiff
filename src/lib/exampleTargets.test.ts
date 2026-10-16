import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { DEFAULT_EXAMPLES, exampleDisplayPath } from './exampleTargets';
import { reviewInputFrom } from './resolveHost';

describe('exampleDisplayPath', () => {
  it('cuts a commit SHA to seven characters and leaves the rest alone', () => {
    assert.equal(
      exampleDisplayPath({
        title: 't',
        path: 'gekichumai/dxrating/commit/637a9c80f69d3222d1c3aed3ae8f4aefdb613bc9',
        scale: 's',
        note: 'n',
      }),
      'gekichumai/dxrating/commit/637a9c8'
    );
    assert.equal(
      exampleDisplayPath({
        title: 't',
        path: 'gitlab-org/gitlab/-/commit/908cae1aed60fd4fb98b0e8d9c4702732969aaa0',
        scale: 's',
        note: 'n',
      }),
      'gitlab-org/gitlab/-/commit/908cae1'
    );
    assert.equal(
      exampleDisplayPath({
        title: 't',
        path: 'oven-sh/bun/pull/30412',
        scale: 's',
        note: 'n',
      }),
      'oven-sh/bun/pull/30412'
    );
  });
});

describe('DEFAULT_EXAMPLES', () => {
  it('gives every row a path that parses as a target on its host', () => {
    for (const [host, rows] of Object.entries(DEFAULT_EXAMPLES)) {
      for (const row of rows) {
        assert.equal(
          reviewInputFrom(`https://${host}/${row.path}`, {
            gitlabHosts: [host],
          }).kind,
          'target',
          `${row.title} does not parse on ${host}`
        );
      }
    }
  });

  it('names each path once per host', () => {
    for (const [host, rows] of Object.entries(DEFAULT_EXAMPLES)) {
      const paths = rows.map((row) => row.path);
      assert.equal(new Set(paths).size, paths.length, `duplicate on ${host}`);
    }
  });

  it('covers all three GitHub target kinds', () => {
    const kinds = new Set(
      DEFAULT_EXAMPLES['github.com'].map((row) => {
        const result = reviewInputFrom(`https://github.com/${row.path}`, {
          gitlabHosts: [],
        });
        return result.kind === 'target' ? result.target.kind : '';
      })
    );
    assert.deepEqual([...kinds].sort(), [
      'github-commit',
      'github-compare',
      'github-pull',
    ]);
  });
});
