import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { parseDeploymentConfig } from './config';
import { instanceInfoFromConfig } from './instance';

// What a deployment serves, out of what it is configured with.

describe('instanceInfoFromConfig', () => {
  it('answers GitHub OAuth from the App pair, and each host from its own', () => {
    const info = instanceInfoFromConfig(
      parseDeploymentConfig({
        GITHUB_APP_CLIENT_ID: 'Iv1.test',
        GITHUB_APP_CLIENT_SECRET: 'app-secret',
        GITLAB_HOSTS:
          '[{"host":"gitlab.corp.com","clientId":"gl-id","clientSecret":"gl-secret"},{"host":"gitlab.com"}]',
        SESSION_SECRET: 'key-one',
      })
    );
    assert.equal(info.github.oauth, true);
    assert.deepEqual(info.gitlab.hosts, [
      { host: 'gitlab.corp.com', oauth: true },
      { host: 'gitlab.com', oauth: false },
    ]);
  });

  it('reads nothing configured as neither offered nor served', () => {
    const info = instanceInfoFromConfig(parseDeploymentConfig({}));
    assert.equal(info.github.oauth, false);
    assert.equal(info.github.served, false);
    assert.deepEqual(info.gitlab.hosts, []);
  });

  it('offers GitHub sign-in only with a key to seal the session', () => {
    const app = {
      GITHUB_APP_CLIENT_ID: 'Iv1.test',
      GITHUB_APP_CLIENT_SECRET: 'app-secret',
    };
    assert.equal(
      instanceInfoFromConfig(
        parseDeploymentConfig({ ...app, SESSION_SECRET: 'key-one' })
      ).github.oauth,
      true
    );
    // An App with no keyring would hand the grant to a cookie nothing seals,
    // and a GitLab host's OAuth pair is no different.
    const unsealed = instanceInfoFromConfig(
      parseDeploymentConfig({
        ...app,
        GITLAB_HOSTS:
          '[{"host":"gitlab.corp.com","clientId":"gl-id","clientSecret":"gl-secret"}]',
      })
    );
    assert.equal(unsealed.github.oauth, false);
    assert.deepEqual(unsealed.gitlab.hosts, [
      { host: 'gitlab.corp.com', oauth: false },
    ]);
  });

  it('serves GitHub for the fallback token alone', () => {
    const info = instanceInfoFromConfig(
      parseDeploymentConfig({ GITHUB_TOKEN: 'tok' })
    );
    assert.equal(info.github.oauth, false);
    assert.equal(info.github.served, true);
  });

  it('narrows the examples to the hosts served, github.com first', () => {
    const info = instanceInfoFromConfig(
      parseDeploymentConfig({
        GITHUB_TOKEN: 'tok',
        GITLAB_HOSTS: '[{"host":"gitlab.corp.com"},{"host":"gitlab.com"}]',
      })
    );
    assert.deepEqual(
      info.examples.map((group) => group.host),
      ['github.com', 'gitlab.com']
    );
  });

  it('drops the github.com group when GitHub is not served', () => {
    const info = instanceInfoFromConfig(
      parseDeploymentConfig({ GITLAB_HOSTS: '[{"host":"gitlab.com"}]' })
    );
    assert.deepEqual(
      info.examples.map((group) => group.host),
      ['gitlab.com']
    );
  });

  it('answers no groups for a host the catalog has no rows for', () => {
    const info = instanceInfoFromConfig(
      parseDeploymentConfig({ GITLAB_HOSTS: '[{"host":"gitlab.corp.com"}]' })
    );
    assert.deepEqual(info.examples, []);
  });

  it('takes the configured catalog over the built-in one', () => {
    const row = {
      title: 't',
      path: 'g/r/-/merge_requests/1',
      scale: 's',
      note: 'n',
    };
    const info = instanceInfoFromConfig(
      parseDeploymentConfig({
        GITLAB_HOSTS: '[{"host":"gitlab.corp.com"}]',
        GHDIFF_EXAMPLES: JSON.stringify({ 'gitlab.corp.com': [row] }),
      })
    );
    assert.deepEqual(info.examples, [{ host: 'gitlab.corp.com', rows: [row] }]);
  });

  it('drops configured github.com rows when GitHub is not served', () => {
    const row = { title: 't', path: 'o/r/pull/2', scale: 's', note: 'n' };
    const info = instanceInfoFromConfig(
      parseDeploymentConfig({
        GITLAB_HOSTS: '[{"host":"gitlab.corp.com"}]',
        GHDIFF_EXAMPLES: JSON.stringify({
          'github.com': [row],
          'gitlab.corp.com': [{ ...row, path: 'g/r/-/merge_requests/1' }],
        }),
      })
    );
    assert.deepEqual(
      info.examples.map((group) => group.host),
      ['gitlab.corp.com']
    );
  });
});
