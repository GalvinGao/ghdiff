import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { diffLanguage } from './diffLanguage.ts';

describe('diffLanguage', () => {
  it('names a Dockerfile wherever it sits', () => {
    assert.equal(diffLanguage('Dockerfile'), 'dockerfile');
    assert.equal(diffLanguage('docker/Dockerfile'), 'dockerfile');
    assert.equal(diffLanguage('apps/web/dockerfile'), 'dockerfile');
  });

  it('names a suffixed Dockerfile', () => {
    assert.equal(diffLanguage('Dockerfile.dev'), 'dockerfile');
    assert.equal(diffLanguage('ci/web.dockerfile'), 'dockerfile');
  });

  it('names an env file and its variants', () => {
    assert.equal(diffLanguage('.env'), 'dotenv');
    assert.equal(diffLanguage('.env.local'), 'dotenv');
    assert.equal(diffLanguage('apps/web/.env.example'), 'dotenv');
    assert.equal(diffLanguage('deploy/production.env'), 'dotenv');
  });

  it('leaves direnv alone, which is shell and not dotenv', () => {
    assert.equal(diffLanguage('.envrc'), undefined);
  });

  it('leaves every extension the library already knows', () => {
    assert.equal(diffLanguage('lib/diffLanguage.ts'), undefined);
    assert.equal(diffLanguage('README.md'), undefined);
    assert.equal(diffLanguage('docker-compose.yml'), undefined);
  });
});
