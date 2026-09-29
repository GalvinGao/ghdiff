import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { acceptRepoLensStore, lensSettings } from '../lenses.ts';
import { acceptEffectSettings, DEFAULT_EFFECT_SETTINGS } from './config.ts';

describe('the Effect lens settings', () => {
  it('is on for a repository nobody has touched', () => {
    assert.deepEqual(lensSettings(undefined, 'effect'), { enabled: true });
    assert.deepEqual(DEFAULT_EFFECT_SETTINGS, { enabled: true });
  });

  it('reads back a switch and refuses anything else', () => {
    assert.deepEqual(acceptEffectSettings({ enabled: false }), {
      enabled: false,
    });
    assert.equal(acceptEffectSettings({ enabled: 'no' }), undefined);
    assert.equal(acceptEffectSettings(true), undefined);
  });

  it('is kept per repository beside the other lenses', () => {
    assert.deepEqual(
      acceptRepoLensStore({
        'a/b': { effect: { enabled: false }, localization: { enabled: true } },
        'c/d': { effect: 1 },
      }),
      {
        'a/b': { effect: { enabled: false }, localization: { enabled: true } },
        'c/d': {},
      }
    );
  });
});
