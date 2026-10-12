import { m } from '@/paraglide/messages.js';
// Preset path filters for the review surface.
//
// The file tree and the diff list are both driven by the selected presets, so
// unticking the tests removes those files from the tree AND from the scroll
// region. Each preset is a pure predicate over a repository-relative path,
// which keeps the rules testable and keeps the UI free of path parsing.
//
// The presets are kinds of file, and a reviewer either reads every file or
// picks the kinds they want: Source and Tests together is both kinds. There is
// no "hide" rule. `fileKind` puts every path in exactly one kind, "Other"
// included, so leaving a kind unticked is how its files are hidden.

export type FilterPresetId =
  | 'source'
  | 'tests'
  | 'config'
  | 'docs'
  | 'generated'
  | 'other';

export interface FilterPreset {
  id: FilterPresetId;
  label: string;
  /** One noun phrase for the menu: what files of this kind are. */
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

/**
 * The one kind a path is. The predicates above overlap — a snapshot is a test
 * and generated, `tests/README.md` is a test and a doc — and a picker of kinds
 * that add up needs each path in exactly one, or unticking Tests would leave
 * every test that another ticked kind also claims. So the first predicate in
 * this order that answers yes decides, and "other" is the path none of them
 * claims: an image, a font, a vendored binary.
 *
 * Tests come first because a test's fixtures and snapshots are read as part of
 * the test. Generated comes next because built output and lock files are not
 * read at all, whatever their extension says they are.
 */
export function fileKind(path: string): FilterPresetId {
  if (isTestPath(path)) return 'tests';
  if (isGeneratedPath(path)) return 'generated';
  if (isDocsPath(path)) return 'docs';
  if (isConfigPath(path)) return 'config';
  if (isSourcePath(path)) return 'source';
  return 'other';
}

export const FILTER_PRESETS: readonly FilterPreset[] = [
  {
    id: 'source',
    get label() {
      return m.filter_rules_source();
    },
    get description() {
      return m.filter_rules_source_description();
    },
    matches: (path) => fileKind(path) === 'source',
  },
  {
    id: 'tests',
    get label() {
      return m.filter_rules_tests();
    },
    get description() {
      return m.filter_rules_tests_description();
    },
    matches: (path) => fileKind(path) === 'tests',
  },
  {
    id: 'config',
    get label() {
      return m.filter_rules_config();
    },
    get description() {
      return m.filter_rules_config_description();
    },
    matches: (path) => fileKind(path) === 'config',
  },
  {
    id: 'docs',
    get label() {
      return m.filter_rules_docs();
    },
    get description() {
      return m.filter_rules_docs_description();
    },
    matches: (path) => fileKind(path) === 'docs',
  },
  {
    id: 'generated',
    get label() {
      return m.filter_rules_generated();
    },
    get description() {
      return m.filter_rules_generated_description();
    },
    matches: (path) => fileKind(path) === 'generated',
  },
  {
    id: 'other',
    get label() {
      return m.filter_rules_other();
    },
    get description() {
      return m.filter_rules_other_description();
    },
    matches: (path) => fileKind(path) === 'other',
  },
];

const PRESET_BY_ID = new Map<FilterPresetId, FilterPreset>(
  FILTER_PRESETS.map((preset) => [preset.id, preset])
);

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

/**
 * Whether a path is one of the kinds picked. No kind picked is "All files",
 * which keeps every path.
 */
export function matchesPresets(
  ids: ReadonlySet<FilterPresetId>,
  path: string
): boolean {
  return ids.size === 0 || ids.has(fileKind(path));
}

/**
 * The selection after one press on a kind. Every kind picked is every file, so
 * that selection is answered as "All files" rather than drawn as six ticks
 * that mean the same thing.
 */
export function togglePreset(
  ids: ReadonlySet<FilterPresetId>,
  id: FilterPresetId
): ReadonlySet<FilterPresetId> {
  const next = new Set(ids);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next.size === FILTER_PRESETS.length ? NO_PRESETS : next;
}

/** No kind picked, which is every file. */
export const NO_PRESETS: ReadonlySet<FilterPresetId> = new Set();
