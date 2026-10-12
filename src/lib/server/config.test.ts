import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { githubServed, parseDeploymentConfig, servesSentence } from './config';
import { DEFAULT_EXAMPLES } from '@/lib/exampleTargets';

// The deployment's configuration, out of the variables the environment holds.
// The loud cases are the point of the suite: a value that says something
// impossible throws naming the offender, and everything absent reads as none.

describe('parseDeploymentConfig', () => {
  it('parses a fully configured deployment', () => {
    const config = parseDeploymentConfig({
      GITHUB_APP_CLIENT_ID: 'Iv1.test',
      GITHUB_APP_CLIENT_SECRET: 'app-secret',
      GITHUB_APP_SLUG: 'ghdiff-test',
      GITHUB_TOKEN: 'ghu_env',
      SESSION_SECRET: 'key-one, key-two',
    });
    assert.deepEqual(config, {
      github: {
        app: {
          clientId: 'Iv1.test',
          clientSecret: 'app-secret',
          slug: 'ghdiff-test',
        },
        token: 'ghu_env',
      },
      examples: DEFAULT_EXAMPLES,
      branding: 'ghdiff.com',
      sessionKeyring: ['key-one', 'key-two'],
    });
  });

  it('reads an absent environment as nothing set', () => {
    assert.deepEqual(parseDeploymentConfig({}), {
      github: {},
      examples: DEFAULT_EXAMPLES,
      branding: 'ghdiff.com',
      sessionKeyring: [],
    });
  });

  it('reads empty and whitespace-only values as absent', () => {
    const config = parseDeploymentConfig({
      GITHUB_TOKEN: '',
      GITHUB_APP_SLUG: '   ',
      SESSION_SECRET: '',
    });
    assert.deepEqual(config, {
      github: {},
      examples: DEFAULT_EXAMPLES,
      branding: 'ghdiff.com',
      sessionKeyring: [],
    });
  });

  it('trims values', () => {
    const config = parseDeploymentConfig({ GITHUB_TOKEN: '  ghu_abc  ' });
    assert.equal(config.github.token, 'ghu_abc');
  });

  it('splits the keyring on commas, trimmed, empties dropped', () => {
    assert.deepEqual(
      parseDeploymentConfig({ SESSION_SECRET: ' key-one, key-two,,  ' })
        .sessionKeyring,
      ['key-one', 'key-two']
    );
  });

  it('throws on half a GitHub App pair', () => {
    assert.throws(
      () => parseDeploymentConfig({ GITHUB_APP_CLIENT_ID: 'Iv1.test' }),
      /come as a pair/
    );
    assert.throws(
      () => parseDeploymentConfig({ GITHUB_APP_CLIENT_SECRET: 'app-secret' }),
      /come as a pair/
    );
  });

  it('ignores variables it does not know', () => {
    const config = parseDeploymentConfig({ PATH: '/usr/bin' });
    assert.deepEqual(config, {
      github: {},
      examples: DEFAULT_EXAMPLES,
      branding: 'ghdiff.com',
      sessionKeyring: [],
    });
  });
});

describe('GHDIFF_EXAMPLES', () => {
  const row = { title: 't', path: 'o/r/pull/2', scale: 's', note: 'n' };

  it('parses a configured catalog, lowercasing the hosts', () => {
    const config = parseDeploymentConfig({
      GHDIFF_EXAMPLES: JSON.stringify({ 'GitHub.com': [row] }),
    });
    assert.deepEqual(config.examples, { 'github.com': [row] });
  });

  it('throws for JSON that does not parse or is not an object', () => {
    assert.throws(
      () => parseDeploymentConfig({ GHDIFF_EXAMPLES: '{"github.com":' }),
      /GHDIFF_EXAMPLES is not valid JSON/
    );
    assert.throws(() =>
      parseDeploymentConfig({ GHDIFF_EXAMPLES: '["github.com"]' })
    );
  });

  it('throws for an entry that is not four non-empty strings', () => {
    assert.throws(() =>
      parseDeploymentConfig({
        GHDIFF_EXAMPLES: JSON.stringify({
          'github.com': [{ title: 't', path: 'o/r/pull/2' }],
        }),
      })
    );
  });

  it('throws for a host this deployment does not serve, naming it', () => {
    assert.throws(
      () =>
        parseDeploymentConfig({
          GHDIFF_EXAMPLES: JSON.stringify({ 'git.example.com': [row] }),
        }),
      /git\.example\.com/
    );
  });

  it('throws for the same host twice, case-insensitively', () => {
    assert.throws(
      () =>
        parseDeploymentConfig({
          GHDIFF_EXAMPLES: JSON.stringify({
            'github.com': [row],
            'GitHub.COM': [row],
          }),
        }),
      /names github\.com twice/i
    );
  });

  it('throws for a path that is no target on its host, naming it', () => {
    assert.throws(
      () =>
        parseDeploymentConfig({
          GHDIFF_EXAMPLES: JSON.stringify({
            'github.com': [{ ...row, path: 'o/r' }],
          }),
        }),
      /o\/r/
    );
  });
});

describe('GHDIFF_BRANDING', () => {
  it('reads ghdiff.com when unset, and the trimmed label otherwise', () => {
    assert.equal(parseDeploymentConfig({}).branding, 'ghdiff.com');
    assert.equal(
      parseDeploymentConfig({ GHDIFF_BRANDING: '  diff.example.com ' })
        .branding,
      'diff.example.com'
    );
  });
});

describe('githubServed', () => {
  it('stands for the App and for the fallback token, and for nothing else', () => {
    assert.equal(
      githubServed(
        parseDeploymentConfig({
          GITHUB_APP_CLIENT_ID: 'id',
          GITHUB_APP_CLIENT_SECRET: 'secret',
        })
      ),
      true
    );
    assert.equal(
      githubServed(parseDeploymentConfig({ GITHUB_TOKEN: 'tok' })),
      true
    );
    assert.equal(githubServed(parseDeploymentConfig({})), false);
  });
});

describe('servesSentence', () => {
  it('names GitHub and its host when GitHub is served', () => {
    const sentence = servesSentence(
      parseDeploymentConfig({
        GITHUB_APP_CLIENT_ID: 'id',
        GITHUB_APP_CLIENT_SECRET: 'secret',
      })
    );
    assert.ok(sentence.includes('GitHub on github.com'));
  });

  it('says so when nothing is configured', () => {
    assert.ok(servesSentence(parseDeploymentConfig({})).includes('no forges'));
  });
});
