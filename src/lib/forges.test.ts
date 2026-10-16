import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { forgeLabel } from './forges';

describe('forgeLabel', () => {
  it('names each forge the way it names itself', () => {
    assert.equal(forgeLabel('github'), 'GitHub');
  });

  it('defaults to GitHub when no forge is named', () => {
    assert.equal(forgeLabel(), 'GitHub');
    assert.equal(forgeLabel(undefined), 'GitHub');
  });
});
