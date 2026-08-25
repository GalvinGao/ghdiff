import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXAMPLE_TARGETS } from './exampleTargets.ts';
import {
  gitHubTargetFromSegments,
  reviewTargetKey,
  reviewTargetSplat,
} from './reviewTarget.ts';

describe('EXAMPLE_TARGETS', () => {
  it('gives every row a splat the /gh route reads back', () => {
    for (const example of EXAMPLE_TARGETS) {
      const splat = reviewTargetSplat(example.target);
      const parsed = gitHubTargetFromSegments(splat.split('/'));
      assert.deepEqual(
        parsed,
        example.target,
        `${example.title} did not survive its own splat`
      );
    }
  });

  it('names each target once', () => {
    const keys = EXAMPLE_TARGETS.map((example) =>
      reviewTargetKey(example.target)
    );
    assert.equal(new Set(keys).size, keys.length);
  });

  it('covers all three target kinds', () => {
    const kinds = new Set(
      EXAMPLE_TARGETS.map((example) => example.target.kind)
    );
    assert.deepEqual([...kinds].sort(), [
      'github-commit',
      'github-compare',
      'github-pull',
    ]);
  });
});
