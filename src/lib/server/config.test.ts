import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  githubServed,
  gitLabHostFor,
  MAX_GITLAB_HOSTS,
  parseDeploymentConfig,
  servesSentence,
} from './config';
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
      GITLAB_HOSTS:
        '[{"host":"GitLab.com","clientId":"gl-id","clientSecret":"gl-secret"},{"host":"gitlab.corp.com:8443"}]',
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
      gitlabHosts: [
        { host: 'gitlab.com', clientId: 'gl-id', clientSecret: 'gl-secret' },
        { host: 'gitlab.corp.com:8443' },
      ],
      examples: DEFAULT_EXAMPLES,
      branding: 'ghdiff.com',
      sessionKeyring: ['key-one', 'key-two'],
    });
  });

  it('reads an absent environment as nothing set', () => {
    assert.deepEqual(parseDeploymentConfig({}), {
      github: {},
      gitlabHosts: [],
      examples: DEFAULT_EXAMPLES,
      branding: 'ghdiff.com',
      sessionKeyring: [],
    });
  });

  it('reads empty and whitespace-only values as absent', () => {
    const config = parseDeploymentConfig({
      GITHUB_TOKEN: '',
      GITLAB_HOSTS: '   ',
      SESSION_SECRET: '',
    });
    assert.deepEqual(config, {
      github: {},
      gitlabHosts: [],
      examples: DEFAULT_EXAMPLES,
      branding: 'ghdiff.com',
      sessionKeyring: [],
    });
  });

  it('trims values and reads empty-string OAuth fields as absent', () => {
    const config = parseDeploymentConfig({
      GITHUB_TOKEN: '  ghu_abc  ',
      GITLAB_HOSTS: '[{"host":"gitlab.com","clientId":"  ","clientSecret":""}]',
    });
    assert.equal(config.github.token, 'ghu_abc');
    assert.deepEqual(config.gitlabHosts, [{ host: 'gitlab.com' }]);
  });

  it('splits the keyring on commas, trimmed, empties dropped', () => {
    assert.deepEqual(
      parseDeploymentConfig({ SESSION_SECRET: ' key-one, key-two,,  ' })
        .sessionKeyring,
      ['key-one', 'key-two']
    );
  });

  it('throws for GITLAB_HOSTS that is not valid JSON', () => {
    assert.throws(
      () => parseDeploymentConfig({ GITLAB_HOSTS: '[{"host":' }),
      /GITLAB_HOSTS is not valid JSON/
    );
  });

  it('keeps the raw value, secrets included, out of the error', () => {
    const secret = 'gloas-not-for-logs';
    assert.throws(
      () =>
        parseDeploymentConfig({
          GITLAB_HOSTS: `[{"host":"gitlab.com","clientSecret":"${secret}"`,
        }),
      (error: Error) => {
        assert.match(error.message, /GITLAB_HOSTS is not valid JSON/);
        assert.ok(!error.message.includes(secret));
        return true;
      }
    );
  });

  it('throws for GITLAB_HOSTS that is not an array of host entries', () => {
    assert.throws(() =>
      parseDeploymentConfig({ GITLAB_HOSTS: '{"host":"gitlab.com"}' })
    );
    assert.throws(() =>
      parseDeploymentConfig({ GITLAB_HOSTS: '["gitlab.com"]' })
    );
  });

  it('throws for a host that is not one, naming the value', () => {
    assert.throws(
      () => parseDeploymentConfig({ GITLAB_HOSTS: '[{"host":"not a host!"}]' }),
      /not a host!/
    );
  });

  it('throws for a port the URL parser would not read back', () => {
    // Each one passes the pattern and breaks every address built on it later.
    for (const host of ['gitlab.example:99999', 'gitlab.example:0']) {
      assert.throws(
        () => parseDeploymentConfig({ GITLAB_HOSTS: `[{"host":"${host}"}]` }),
        new RegExp(host)
      );
    }
    assert.deepEqual(
      parseDeploymentConfig({
        GITLAB_HOSTS: '[{"host":"gitlab.corp.com:8443"}]',
      }).gitlabHosts,
      [{ host: 'gitlab.corp.com:8443' }]
    );
  });

  it('throws for more hosts than one session cookie can hold', () => {
    const hosts = (count: number) =>
      JSON.stringify(
        Array.from({ length: count }, (_, i) => ({ host: `gitlab-${i}.com` }))
      );
    assert.equal(
      parseDeploymentConfig({ GITLAB_HOSTS: hosts(MAX_GITLAB_HOSTS) })
        .gitlabHosts.length,
      MAX_GITLAB_HOSTS
    );
    assert.throws(
      () =>
        parseDeploymentConfig({ GITLAB_HOSTS: hosts(MAX_GITLAB_HOSTS + 1) }),
      /more than \d+ hosts/
    );
  });

  it('throws for the same host twice, case-insensitively', () => {
    assert.throws(
      () =>
        parseDeploymentConfig({
          GITLAB_HOSTS: '[{"host":"gitlab.com"},{"host":"GitLab.COM"}]',
        }),
      /names gitlab\.com twice/
    );
  });

  it('throws on half a GitLab OAuth pair, naming the host', () => {
    assert.throws(
      () =>
        parseDeploymentConfig({
          GITLAB_HOSTS: '[{"host":"gitlab.corp.com","clientId":"id"}]',
        }),
      /gitlab\.corp\.com/
    );
    assert.throws(
      () =>
        parseDeploymentConfig({
          GITLAB_HOSTS: '[{"host":"gitlab.corp.com","clientSecret":"secret"}]',
        }),
      /gitlab\.corp\.com/
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
    const config = parseDeploymentConfig({
      PATH: '/usr/bin',
      GHDIFF_FORGE: 'gitlab',
    });
    assert.deepEqual(config, {
      github: {},
      gitlabHosts: [],
      examples: DEFAULT_EXAMPLES,
      branding: 'ghdiff.com',
      sessionKeyring: [],
    });
  });
});

describe('GHDIFF_EXAMPLES', () => {
  const row = {
    title: 't',
    path: 'g/r/-/merge_requests/1',
    scale: 's',
    note: 'n',
  };

  it('parses a configured catalog, lowercasing the hosts', () => {
    const config = parseDeploymentConfig({
      GITLAB_HOSTS: '[{"host":"gitlab.corp.com"}]',
      GHDIFF_EXAMPLES: JSON.stringify({
        'GitLab.Corp.com': [row],
        'github.com': [{ ...row, path: 'o/r/pull/2' }],
      }),
    });
    assert.deepEqual(config.examples, {
      'gitlab.corp.com': [row],
      'github.com': [{ ...row, path: 'o/r/pull/2' }],
    });
  });

  it('throws for JSON that does not parse or is not an object', () => {
    assert.throws(
      () => parseDeploymentConfig({ GHDIFF_EXAMPLES: '{"github.com":' }),
      /GHDIFF_EXAMPLES is not valid JSON/
    );
    assert.throws(() =>
      parseDeploymentConfig({ GHDIFF_EXAMPLES: '["gitlab.com"]' })
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
          GHDIFF_EXAMPLES: JSON.stringify({ 'gitlab.other.com': [row] }),
        }),
      /gitlab\.other\.com/
    );
  });

  it('throws for the same host twice, case-insensitively', () => {
    assert.throws(
      () =>
        parseDeploymentConfig({
          GITLAB_HOSTS: '[{"host":"gitlab.corp.com"}]',
          GHDIFF_EXAMPLES: JSON.stringify({
            'gitlab.corp.com': [row],
            'GitLab.CORP.com': [row],
          }),
        }),
      /names gitlab\.corp\.com twice/i
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
    assert.throws(
      () =>
        parseDeploymentConfig({
          GITLAB_HOSTS: '[{"host":"gitlab.corp.com"}]',
          GHDIFF_EXAMPLES: JSON.stringify({
            'gitlab.corp.com': [{ ...row, path: 'g/r/pull/1' }],
          }),
        }),
      /g\/r\/pull\/1/
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

describe('gitLabHostFor', () => {
  const config = parseDeploymentConfig({
    GITLAB_HOSTS: '[{"host":"gitlab.com"},{"host":"gitlab.corp.com:8443"}]',
  });

  it('answers the configured host case-insensitively', () => {
    assert.equal(gitLabHostFor(config, 'GitLab.Com')?.host, 'gitlab.com');
    assert.equal(
      gitLabHostFor(config, 'GITLAB.corp.com:8443')?.host,
      'gitlab.corp.com:8443'
    );
  });

  it('answers nothing for a host the deployment does not serve', () => {
    assert.equal(gitLabHostFor(config, 'example.com'), undefined);
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
  it('names GitHub alone when no GitLab host is configured', () => {
    const sentence = servesSentence(
      parseDeploymentConfig({
        GITHUB_APP_CLIENT_ID: 'id',
        GITHUB_APP_CLIENT_SECRET: 'secret',
      })
    );
    assert.ok(sentence.includes('GitHub on github.com'));
    assert.ok(!sentence.includes('GitLab'));
  });

  it('names the configured hosts in configured order', () => {
    const sentence = servesSentence(
      parseDeploymentConfig({
        GITHUB_TOKEN: 'tok',
        GITLAB_HOSTS: '[{"host":"gitlab.com"},{"host":"gitlab.corp.com"}]',
      })
    );
    assert.ok(sentence.includes('GitHub on github.com'));
    // The hosts are a list in the reader's language; what is pinned is that
    // both are named, in the order they were configured.
    assert.ok(
      sentence.indexOf('gitlab.com') < sentence.indexOf('gitlab.corp.com')
    );
  });

  it('names only GitLab when GitHub is not served', () => {
    const sentence = servesSentence(
      parseDeploymentConfig({ GITLAB_HOSTS: '[{"host":"gitlab.corp.com"}]' })
    );
    assert.ok(sentence.includes('GitLab on gitlab.corp.com'));
    assert.ok(!sentence.includes('GitHub'));
  });

  it('says so when nothing is configured', () => {
    assert.ok(servesSentence(parseDeploymentConfig({})).includes('no forges'));
  });
});
