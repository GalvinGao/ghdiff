import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { heldLegacyToken } from './legacyToken.ts';

// The point of this file is the second block: ghdiff works signed out, and a
// reviewer who never held a token must never be redirected off the page they
// asked for. Every reading that is not an actual stored token has to answer no.

describe('heldLegacyToken', () => {
  it('answers yes only for a token this browser is really holding', () => {
    assert.equal(heldLegacyToken('github_pat_11ABCDE'), true);
    assert.equal(heldLegacyToken('ghp_classicTokenStyle'), true);
  });

  it('answers no for every reading an anonymous browser can give', () => {
    // A reviewer who never set one has no key at all, which is `null`.
    assert.equal(heldLegacyToken(null), false);
    // `getItem` on a missing key is `null`, but a caller reading through an
    // optional chain gets `undefined`, and both mean the same thing here.
    assert.equal(heldLegacyToken(undefined), false);
    // Nothing wrote these, but a redirect is not worth risking on that.
    assert.equal(heldLegacyToken(''), false);
    assert.equal(heldLegacyToken('   '), false);
    assert.equal(heldLegacyToken('\n\t'), false);
  });

  it('answers no for anything that is not a string at all', () => {
    // Storage hands back strings, but this value has come from a browser and
    // the type is not worth trusting on the strength of that.
    for (const raw of [0, 1, {}, [], true, false] as unknown[]) {
      assert.equal(heldLegacyToken(raw as string), false, String(raw));
    }
  });
});
