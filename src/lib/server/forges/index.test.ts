import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { forgeFor, forgeNamed } from './';
import { parseDeploymentConfig } from '@/lib/server/config';
import { GitHubError } from '@/lib/server/github/client';

// The forge gate: a ref answers only for a forge this deployment serves, and
// anything else is a 404 whose sentence says what it does serve.

describe('forgeFor', () => {
  const githubRef = { forge: 'github', owner: 'o', repo: 'r' } as const;
  const gitLabRef = {
    forge: 'gitlab',
    host: 'gitlab.corp.com',
    project: 'g/r',
  } as const;

  it('answers a GitHub ref while the App or the token is configured', () => {
    const app = parseDeploymentConfig({
      GITHUB_APP_CLIENT_ID: 'id',
      GITHUB_APP_CLIENT_SECRET: 'secret',
    });
    const token = parseDeploymentConfig({ GITHUB_TOKEN: 'tok' });
    assert.equal(forgeFor(app, githubRef), forgeNamed('github'));
    assert.equal(forgeFor(token, githubRef), forgeNamed('github'));
  });

  it('answers a GitHub ref 404 when GitHub is not served', () => {
    const config = parseDeploymentConfig({
      GITLAB_HOSTS: '[{"host":"gitlab.corp.com"}]',
    });
    assert.throws(
      () => forgeFor(config, githubRef),
      (error) =>
        error instanceof GitHubError &&
        error.status === 404 &&
        error.message.includes('GitLab on gitlab.corp.com') &&
        // Typed, so the client never reads this 404 as a missing repository.
        error.failure?.reason === 'not-served' &&
        error.failure.forge === 'github'
    );
  });

  it('answers a GitLab ref only for a configured host', () => {
    const config = parseDeploymentConfig({
      GITLAB_HOSTS: '[{"host":"gitlab.corp.com"}]',
    });
    assert.equal(forgeFor(config, gitLabRef), forgeNamed('gitlab'));
    assert.throws(
      () => forgeFor(config, { ...gitLabRef, host: 'gitlab.other.com' }),
      (error) =>
        error instanceof GitHubError &&
        error.status === 404 &&
        error.failure?.reason === 'not-served' &&
        error.failure.host === 'gitlab.other.com'
    );
  });
});
