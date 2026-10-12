import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { parseDeploymentConfig } from './config';
import { instanceInfoFromConfig } from './instance';

// What a deployment serves, out of what it is configured with.

describe('instanceInfoFromConfig', () => {
  it('reads nothing configured as neither offered nor served', () => {
    const info = instanceInfoFromConfig(parseDeploymentConfig({}));
    assert.equal(info.github.oauth, false);
    assert.equal(info.github.served, false);
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
    // An App with no keyring would hand the grant to a cookie nothing seals.
    assert.equal(
      instanceInfoFromConfig(parseDeploymentConfig(app)).github.oauth,
      false
    );
  });

  it('serves GitHub for the fallback token alone', () => {
    const info = instanceInfoFromConfig(
      parseDeploymentConfig({ GITHUB_TOKEN: 'tok' })
    );
    assert.equal(info.github.oauth, false);
    assert.equal(info.github.served, true);
  });
});
