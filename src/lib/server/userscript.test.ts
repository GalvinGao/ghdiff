import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import { buildUserscript } from './userscript';

// The userscript, filled for one deployment. The template is the real file:
// the placeholders it replaces are the contract between the two, and a
// template that lost one would fail silently here otherwise.
const TEMPLATE = readFileSync(new URL('./ghdiff.user.js', import.meta.url), {
  encoding: 'utf8',
});

describe('buildUserscript', () => {
  it('matches github.com', () => {
    const script = buildUserscript(TEMPLATE, 'https://ghdiff.com');
    assert.ok(script.includes('// @match        https://github.com/*\n'));
  });

  it('substitutes the origin everywhere and leaves no placeholder', () => {
    const script = buildUserscript(TEMPLATE, 'https://diff.example.com');
    assert.ok(!script.includes('__GHDIFF_'));
    assert.ok(
      script.includes(
        '// @downloadURL  https://diff.example.com/ghdiff.user.js'
      )
    );
    // The bundler writes the constant in either quote; the origin is what
    // the assertion is about.
    assert.match(
      script,
      /const APP_ORIGIN = ["']https:\/\/diff\.example\.com["'];/
    );
  });

  it('holds the metadata a manager reads', () => {
    assert.ok(TEMPLATE.includes('// @version      '));
    assert.ok(TEMPLATE.includes('// @match        __GHDIFF_MATCHES__'));
    assert.ok(TEMPLATE.includes('__GHDIFF_ORIGIN__'));
    assert.equal(TEMPLATE.split('__GHDIFF_MATCHES__').length - 1, 1);
  });
});
