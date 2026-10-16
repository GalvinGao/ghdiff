import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import { parseDeploymentConfig } from './config';
import { buildUserscript } from './userscript';

// The userscript, filled for one deployment. The template is the real file:
// the placeholders it replaces are the contract between the two, and a
// template that lost one would fail silently here otherwise.
const TEMPLATE = readFileSync(new URL('./ghdiff.user.js', import.meta.url), {
  encoding: 'utf8',
});

describe('buildUserscript', () => {
  it('matches every host served, github.com first', () => {
    const script = buildUserscript(
      TEMPLATE,
      parseDeploymentConfig({
        GITHUB_TOKEN: 'tok',
        GITLAB_HOSTS: '[{"host":"gitlab.corp.com"}]',
      }),
      'https://ghdiff.com'
    );
    assert.ok(script.includes('// @match        https://github.com/*\n'));
    assert.ok(script.includes('// @match        https://gitlab.corp.com/*\n'));
  });

  it('matches no github.com when GitHub is not served', () => {
    const script = buildUserscript(
      TEMPLATE,
      parseDeploymentConfig({ GITLAB_HOSTS: '[{"host":"gitlab.corp.com"}]' }),
      'https://ghdiff.example.com'
    );
    assert.ok(!script.includes('https://github.com/*'));
    assert.ok(script.includes('// @match        https://gitlab.corp.com/*\n'));
  });

  it('strips the port from a match pattern, once per hostname', () => {
    const script = buildUserscript(
      TEMPLATE,
      parseDeploymentConfig({
        GITLAB_HOSTS:
          '[{"host":"gitlab.corp.com"},{"host":"gitlab.corp.com:8443"}]',
      }),
      'https://ghdiff.com'
    );
    const occurrences = script.split('https://gitlab.corp.com/*').length - 1;
    assert.equal(occurrences, 1);
    assert.ok(!script.includes('gitlab.corp.com:8443/*'));
  });

  it('keeps the ports in the host list the script checks itself against', () => {
    // The match pattern reaches every port on a name; the list the script
    // reads `location.host` against is what narrows it to the one served.
    const script = buildUserscript(
      TEMPLATE,
      parseDeploymentConfig({
        GITHUB_TOKEN: 'tok',
        GITLAB_HOSTS: '[{"host":"gitlab.corp.com:8443"}]',
      }),
      'https://ghdiff.com'
    );
    assert.match(script, /["']github\.com,gitlab\.corp\.com:8443["']\.split/);
  });

  it('substitutes the origin everywhere and leaves no placeholder', () => {
    const script = buildUserscript(
      TEMPLATE,
      parseDeploymentConfig({ GITHUB_TOKEN: 'tok' }),
      'https://diff.example.com'
    );
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
    assert.ok(TEMPLATE.includes('__GHDIFF_HOSTS__'));
    assert.equal(TEMPLATE.split('__GHDIFF_MATCHES__').length - 1, 1);
  });
});
