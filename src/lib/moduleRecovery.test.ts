import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { claimModuleReload, isModuleLoadError } from './moduleRecovery';

describe('module recovery', () => {
  it('recognizes browser module download failures without reloading other errors', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://ghdiff.com/assets/routes-old.js',
      'error loading dynamically imported module: https://ghdiff.com/assets/routes-old.js',
      'Importing a module script failed.',
      'Loading chunk 12 failed.',
    ]) {
      assert.equal(isModuleLoadError(new TypeError(message)), true);
    }
    assert.equal(isModuleLoadError(new Error('Failed to fetch')), false);
    assert.equal(
      isModuleLoadError(new Error('Cannot read properties of undefined')),
      false
    );
  });

  it('allows one reload across remounts and page loads, then retries after a minute', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    assert.equal(claimModuleReload(storage, 100_000), true);
    assert.equal(claimModuleReload(storage, 100_001), false);
    assert.equal(claimModuleReload(storage, 159_999), false);
    assert.equal(claimModuleReload(storage, 160_000), true);
  });

  it('does not automatically reload when the guard cannot be persisted', () => {
    assert.equal(
      claimModuleReload({
        getItem: () => null,
        setItem: () => {
          throw new Error('Storage blocked');
        },
      }),
      false
    );
  });
});
