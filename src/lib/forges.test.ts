import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { findGitLabHost, forgeLabel } from './forges';

describe('forgeLabel', () => {
  it('names each forge the way it names itself', () => {
    assert.equal(forgeLabel('github'), 'GitHub');
    assert.equal(forgeLabel('gitlab'), 'GitLab');
  });

  it('defaults to GitHub when no forge is named', () => {
    assert.equal(forgeLabel(), 'GitHub');
    assert.equal(forgeLabel(undefined), 'GitHub');
  });
});

describe('findGitLabHost', () => {
  it('matches without case and keeps the list’s own spelling', () => {
    const hosts = ['gitlab.com', 'gitlab.corp.com:8443'];
    assert.equal(findGitLabHost(hosts, 'GITLAB.corp.com:8443'), hosts[1]);
    assert.equal(findGitLabHost(hosts, 'elsewhere.example.com'), undefined);
  });

  it('finds the entry carrying the host', () => {
    const hosts = [
      { host: 'gitlab.com', oauth: true },
      { host: 'gitlab.corp.com', oauth: false },
    ];
    assert.equal(findGitLabHost(hosts, 'GitLab.Corp.com'), hosts[1]);
  });
});
