import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_FILTER_PRESET_ID,
  FILTER_PRESETS,
  getFilterPreset,
  isConfigPath,
  isDocsPath,
  isFilterPresetId,
  isGeneratedPath,
  isSourcePath,
  isTestPath,
} from './filterRules.ts';

describe('isTestPath', () => {
  const testPaths = [
    'src/lib/parse.test.ts',
    'src/lib/parse.spec.tsx',
    'src/lib/__tests__/parse.ts',
    'test/helpers.ts',
    'tests/helpers.ts',
    'spec/models/user_spec.rb',
    'internal/server/server_test.go',
    'src/main/java/com/x/UserTest.java',
    'src/X/UserTests.cs',
    'app/tests/test_views.py',
    'conftest.py',
    'e2e/checkout.ts',
    'cypress/support/commands.js',
    'testdata/input.json',
    'src/__snapshots__/App.tsx.snap',
    'packages/core/fixtures/sample.json',
  ];

  for (const path of testPaths) {
    it(`treats ${path} as a test path`, () => {
      assert.equal(isTestPath(path), true);
    });
  }

  const productionPaths = [
    'src/lib/parse.ts',
    'src/components/Latest.tsx',
    'src/protest/rally.ts',
    'src/contest.ts',
    'README.md',
    'package.json',
    'src/testimonials/list.ts',
  ];

  for (const path of productionPaths) {
    it(`does not treat ${path} as a test path`, () => {
      assert.equal(isTestPath(path), false);
    });
  }
});

describe('isGeneratedPath', () => {
  it('matches lock files', () => {
    assert.equal(isGeneratedPath('pnpm-lock.yaml'), true);
    assert.equal(isGeneratedPath('apps/web/package-lock.json'), true);
    assert.equal(isGeneratedPath('Cargo.lock'), true);
  });

  it('matches build and vendor directories', () => {
    assert.equal(isGeneratedPath('dist/index.js'), true);
    assert.equal(isGeneratedPath('vendor/github.com/x/y.go'), true);
    assert.equal(isGeneratedPath('src/__generated__/schema.ts'), true);
  });

  it('leaves hand-written files alone', () => {
    assert.equal(isGeneratedPath('src/index.ts'), false);
    assert.equal(isGeneratedPath('package.json'), false);
  });
});

describe('isDocsPath', () => {
  it('matches prose files and doc directories', () => {
    assert.equal(isDocsPath('README.md'), true);
    assert.equal(isDocsPath('docs/architecture/overview.mdx'), true);
    assert.equal(isDocsPath('CHANGELOG.txt'), true);
  });

  it('does not match code', () => {
    assert.equal(isDocsPath('src/index.ts'), false);
  });
});

describe('isConfigPath', () => {
  it('matches manifests and dotfiles', () => {
    assert.equal(isConfigPath('package.json'), true);
    assert.equal(isConfigPath('tsconfig.json'), true);
    assert.equal(isConfigPath('.github/workflows/lint.yml'), true);
    assert.equal(isConfigPath('.gitignore'), true);
    assert.equal(isConfigPath('Dockerfile'), true);
    assert.equal(isConfigPath('Cargo.toml'), true);
  });

  it('excludes lock files, which are generated rather than configured', () => {
    assert.equal(isConfigPath('pnpm-lock.yaml'), false);
    assert.equal(isConfigPath('package-lock.json'), false);
  });

  it('does not match code or prose', () => {
    assert.equal(isConfigPath('src/index.ts'), false);
    assert.equal(isConfigPath('README.md'), false);
  });
});

describe('isSourcePath', () => {
  it('matches production code', () => {
    assert.equal(isSourcePath('src/index.ts'), true);
    assert.equal(isSourcePath('internal/server/server.go'), true);
    assert.equal(isSourcePath('app/globals.css'), true);
  });

  it('rejects tests and generated code', () => {
    assert.equal(isSourcePath('src/index.test.ts'), false);
    assert.equal(isSourcePath('dist/index.js'), false);
  });

  it('rejects prose and manifests', () => {
    assert.equal(isSourcePath('README.md'), false);
    assert.equal(isSourcePath('package.json'), false);
  });
});

describe('FILTER_PRESETS', () => {
  it('exposes a unique id per preset', () => {
    const ids = FILTER_PRESETS.map((preset) => preset.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('resolves every id it advertises', () => {
    for (const preset of FILTER_PRESETS) {
      assert.equal(getFilterPreset(preset.id).id, preset.id);
      assert.equal(isFilterPresetId(preset.id), true);
    }
  });

  it('rejects an unknown id', () => {
    assert.equal(isFilterPresetId('nope'), false);
    assert.throws(() => getFilterPreset('nope' as never));
  });

  it('defaults to showing everything', () => {
    const preset = getFilterPreset(DEFAULT_FILTER_PRESET_ID);
    assert.equal(preset.matches('anything/at/all.ts'), true);
  });

  it('keeps "tests" and "without-tests" complementary', () => {
    const tests = getFilterPreset('tests');
    const withoutTests = getFilterPreset('without-tests');
    for (const path of ['a/b.test.ts', 'a/b.ts', 'test/c.ts', 'README.md']) {
      assert.notEqual(tests.matches(path), withoutTests.matches(path));
    }
  });
});
