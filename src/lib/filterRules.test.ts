import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FILTER_PRESETS,
  getFilterPreset,
  isConfigPath,
  isDocsPath,
  isFilterPresetId,
  fileKind,
  matchesPresets,
  NO_PRESETS,
  togglePreset,
  isGeneratedPath,
  isSourcePath,
  isTestPath,
} from './filterRules.ts';

it('keeps separator and case semantics when identifying path segments', () => {
  assert.equal(isTestPath('//SRC///TESTS/file.ts///'), true);
  assert.equal(isGeneratedPath('//vendor///file.ts/'), true);
  assert.equal(isGeneratedPath('vendor///'), false);
  assert.equal(isDocsPath('//DOCS///file.ts//'), true);
  assert.equal(isConfigPath('///Dockerfile///'), true);
  assert.equal(isSourcePath('//SRC///file.TS///'), true);
  for (const preset of FILTER_PRESETS) {
    if (preset.id === 'all' || preset.id.startsWith('without-')) continue;
    assert.equal(preset.matches('////'), false);
  }
});

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

  it('puts every path in at least one kind', () => {
    for (const path of [
      'src/a.ts',
      'src/a.test.ts',
      'README.md',
      'package.json',
      'pnpm-lock.yaml',
      'assets/logo.png',
      'LICENSE',
    ]) {
      assert.equal(
        FILTER_PRESETS.some((preset) => preset.matches(path)),
        true,
        path
      );
    }
  });
});

describe('fileKind', () => {
  it('claims what no other kind does as "other"', () => {
    assert.equal(fileKind('assets/logo.png'), 'other');
    assert.equal(fileKind('src/a.ts'), 'source');
    assert.equal(fileKind('pnpm-lock.yaml'), 'generated');
  });

  it('puts a path two predicates claim in one kind', () => {
    assert.equal(fileKind('src/__snapshots__/a.snap'), 'tests');
    assert.equal(fileKind('tests/fixture.json'), 'tests');
    assert.equal(fileKind('tests/README.md'), 'tests');
    assert.equal(fileKind('dist/README.md'), 'generated');
  });

  it('is the one preset each path matches', () => {
    for (const path of [
      'src/__snapshots__/a.snap',
      'tests/README.md',
      'dist/README.md',
      'package.json',
      'LICENSE',
    ]) {
      const matched = FILTER_PRESETS.filter((preset) => preset.matches(path));
      assert.deepEqual(
        matched.map((preset) => preset.id),
        [fileKind(path)],
        path
      );
    }
  });
});

describe('togglePreset', () => {
  it('adds a preset and takes it away again', () => {
    const once = togglePreset(NO_PRESETS, 'source');
    assert.deepEqual([...once], ['source']);
    const twice = togglePreset(once, 'tests');
    assert.deepEqual([...twice].sort(), ['source', 'tests']);
    assert.deepEqual([...togglePreset(twice, 'source')], ['tests']);
  });

  it('answers every kind ticked as no kind at all', () => {
    let picked = NO_PRESETS;
    for (const preset of FILTER_PRESETS) {
      picked = togglePreset(picked, preset.id);
    }
    assert.equal(picked.size, 0);
  });
});

describe('matchesPresets', () => {
  it('keeps everything with no preset picked', () => {
    assert.equal(matchesPresets(NO_PRESETS, 'anything.bin'), true);
  });

  it('hides every test when Tests is the one kind left unticked', () => {
    const picked = new Set(
      FILTER_PRESETS.map((preset) => preset.id).filter((id) => id !== 'tests')
    );
    for (const path of [
      'src/__snapshots__/a.snap',
      'tests/fixture.json',
      'tests/README.md',
    ]) {
      assert.equal(matchesPresets(picked, path), false, path);
    }
    assert.equal(matchesPresets(picked, 'src/a.ts'), true);
  });

  it('keeps a path any picked kind matches', () => {
    const picked = new Set(['source', 'tests'] as const);
    assert.equal(matchesPresets(picked, 'src/a.ts'), true);
    assert.equal(matchesPresets(picked, 'src/a.test.ts'), true);
    assert.equal(matchesPresets(picked, 'README.md'), false);
  });
});
