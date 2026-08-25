// Preset path filters for the review surface.
//
// The file tree and the diff list are both driven by one selected preset, so
// "hide the tests" removes those files from the tree AND from the scroll
// region. Each preset is a pure predicate over a repository-relative path,
// which keeps the rules testable and keeps the UI free of path parsing.

export type FilterPresetId =
  | 'all'
  | 'tests'
  | 'without-tests'
  | 'source'
  | 'docs'
  | 'config'
  | 'generated'
  | 'without-generated';

export interface FilterPreset {
  id: FilterPresetId;
  label: string;
  /** One sentence for the menu, in the imperative. */
  description: string;
  matches(path: string): boolean;
}

const CODE_EXTENSIONS = new Set([
  'astro',
  'c',
  'cc',
  'cjs',
  'clj',
  'cpp',
  'cs',
  'css',
  'cts',
  'dart',
  'ex',
  'exs',
  'go',
  'h',
  'hpp',
  'hs',
  'java',
  'js',
  'jsx',
  'kt',
  'kts',
  'lua',
  'm',
  'mjs',
  'mm',
  'mts',
  'php',
  'pl',
  'py',
  'rb',
  'rs',
  'scala',
  'scss',
  'sh',
  'sql',
  'svelte',
  'swift',
  'ts',
  'tsx',
  'vue',
  'zig',
]);

const DOC_EXTENSIONS = new Set(['adoc', 'markdown', 'md', 'mdx', 'rst', 'txt']);

const CONFIG_EXTENSIONS = new Set([
  'cfg',
  'conf',
  'editorconfig',
  'env',
  'ini',
  'json',
  'json5',
  'jsonc',
  'properties',
  'toml',
  'yaml',
  'yml',
]);

const CONFIG_BASENAMES = new Set([
  '.dockerignore',
  '.gitattributes',
  '.gitignore',
  '.node-version',
  '.nvmrc',
  'dockerfile',
  'makefile',
  'procfile',
]);

const GENERATED_BASENAMES = new Set([
  'bun.lock',
  'bun.lockb',
  'cargo.lock',
  'composer.lock',
  'gemfile.lock',
  'go.sum',
  'package-lock.json',
  'pnpm-lock.yaml',
  'poetry.lock',
  'uv.lock',
  'yarn.lock',
]);

const GENERATED_DIRECTORIES = new Set([
  '__generated__',
  '__snapshots__',
  'dist',
  'generated',
  'node_modules',
  'target',
  'vendor',
]);

const TEST_DIRECTORIES = new Set([
  '__mocks__',
  '__snapshots__',
  '__tests__',
  'cypress',
  'e2e',
  'fixtures',
  'spec',
  'test',
  'testdata',
  'tests',
]);

const TEST_BASENAMES = new Set([
  'conftest.py',
  'jest.setup.ts',
  'setuptests.ts',
]);

// `foo.test.ts`, `foo_test.go`, `foo-test.js`, `FooTest.java`, `FooTests.cs`,
// `test_foo.py`, `spec_helper.rb`, `foo.spec.tsx`, `foo.snap`.
const TEST_FILENAME_PATTERNS = [
  /[.\-_](?:test|spec)s?\.[^.]+$/i,
  /^(?:test|spec)[._-]/i,
  /(?:Test|Tests|Spec|Specs)\.[^.]+$/,
  /\.snap$/i,
];

function segments(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

function basename(path: string): string {
  const parts = segments(path);
  return parts.length === 0 ? '' : parts[parts.length - 1];
}

function extension(path: string): string {
  const name = basename(path);
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex <= 0) {
    return '';
  }
  return name.slice(dotIndex + 1).toLowerCase();
}

function hasDirectory(path: string, directories: ReadonlySet<string>): boolean {
  const parts = segments(path);
  // Stop before the last segment: that one is the file name.
  for (let index = 0; index < parts.length - 1; index++) {
    if (directories.has(parts[index].toLowerCase())) {
      return true;
    }
  }
  return false;
}

export function isTestPath(path: string): boolean {
  if (hasDirectory(path, TEST_DIRECTORIES)) {
    return true;
  }
  const name = basename(path);
  if (TEST_BASENAMES.has(name.toLowerCase())) {
    return true;
  }
  return TEST_FILENAME_PATTERNS.some((pattern) => pattern.test(name));
}

export function isGeneratedPath(path: string): boolean {
  if (GENERATED_BASENAMES.has(basename(path).toLowerCase())) {
    return true;
  }
  return hasDirectory(path, GENERATED_DIRECTORIES);
}

export function isDocsPath(path: string): boolean {
  if (DOC_EXTENSIONS.has(extension(path))) {
    return true;
  }
  return hasDirectory(path, new Set(['doc', 'docs']));
}

export function isConfigPath(path: string): boolean {
  if (isGeneratedPath(path)) {
    return false;
  }
  const name = basename(path).toLowerCase();
  if (CONFIG_BASENAMES.has(name)) {
    return true;
  }
  if (name.startsWith('dockerfile')) {
    return true;
  }
  return CONFIG_EXTENSIONS.has(extension(path));
}

export function isSourcePath(path: string): boolean {
  if (isTestPath(path) || isGeneratedPath(path)) {
    return false;
  }
  return CODE_EXTENSIONS.has(extension(path));
}

export const FILTER_PRESETS: readonly FilterPreset[] = [
  {
    id: 'all',
    label: 'All files',
    description: 'Show every file in the diff.',
    matches: () => true,
  },
  {
    id: 'without-tests',
    label: 'Hide tests',
    description: 'Hide test files, fixtures, and snapshots.',
    matches: (path) => !isTestPath(path),
  },
  {
    id: 'tests',
    label: 'Tests only',
    description: 'Show only test files, fixtures, and snapshots.',
    matches: isTestPath,
  },
  {
    id: 'source',
    label: 'Source only',
    description: 'Show only code files that are not tests and not generated.',
    matches: isSourcePath,
  },
  {
    id: 'docs',
    label: 'Docs only',
    description: 'Show only Markdown and other prose files.',
    matches: isDocsPath,
  },
  {
    id: 'config',
    label: 'Config only',
    description: 'Show only manifests, lint configs, and CI files.',
    matches: isConfigPath,
  },
  {
    id: 'without-generated',
    label: 'Hide generated',
    description: 'Hide lock files, snapshots, and build output.',
    matches: (path) => !isGeneratedPath(path),
  },
  {
    id: 'generated',
    label: 'Generated only',
    description: 'Show only lock files, snapshots, and build output.',
    matches: isGeneratedPath,
  },
];

const PRESET_BY_ID = new Map<FilterPresetId, FilterPreset>(
  FILTER_PRESETS.map((preset) => [preset.id, preset])
);

export const DEFAULT_FILTER_PRESET_ID: FilterPresetId = 'all';

export function getFilterPreset(id: FilterPresetId): FilterPreset {
  const preset = PRESET_BY_ID.get(id);
  if (preset == null) {
    throw new Error(`Unknown filter preset: ${id}`);
  }
  return preset;
}

export function isFilterPresetId(value: string): value is FilterPresetId {
  return PRESET_BY_ID.has(value as FilterPresetId);
}
