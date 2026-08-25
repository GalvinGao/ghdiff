import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fineGrainedTokenUrl, TOKEN_PERMISSIONS } from './githubToken.ts';

/** The parameters that fill the fields at the top of GitHub's form. */
const FORM_FIELDS = ['name', 'description', 'expires_in'];

describe('fineGrainedTokenUrl', () => {
  it('opens the page for a new fine-grained token', () => {
    const url = new URL(fineGrainedTokenUrl());
    assert.equal(url.origin, 'https://github.com');
    assert.equal(url.pathname, '/settings/personal-access-tokens/new');
  });

  it('names the token and gives it an expiry', () => {
    const url = new URL(fineGrainedTokenUrl());
    assert.equal(url.searchParams.get('name'), 'ghdiff');
    assert.equal(url.searchParams.get('expires_in'), '90');
    assert.notEqual(url.searchParams.get('description'), null);
  });

  it('asks for every permission the form lists beside it', () => {
    const url = new URL(fineGrainedTokenUrl());
    for (const { access, slug } of TOKEN_PERMISSIONS) {
      assert.equal(url.searchParams.get(slug), access, slug);
    }
  });

  it('asks for write on pull requests and read everywhere else', () => {
    const url = new URL(fineGrainedTokenUrl());
    assert.equal(url.searchParams.get('pull_requests'), 'write');
    assert.equal(url.searchParams.get('contents'), 'read');
    assert.equal(url.searchParams.get('statuses'), 'read');
    assert.equal(url.searchParams.get('checks'), 'read');
  });

  it('asks for nothing the list does not name', () => {
    // The point of the list under the link is that it is the whole ask. A
    // parameter here that no row names would grant something unannounced.
    const url = new URL(fineGrainedTokenUrl());
    const asked = [...url.searchParams.keys()].filter(
      (key) => !FORM_FIELDS.includes(key)
    );
    assert.deepEqual(
      asked.sort(),
      TOKEN_PERMISSIONS.map((permission) => permission.slug).sort()
    );
  });
});
