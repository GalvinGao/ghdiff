import { parsePatchFiles } from '@pierre/diffs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  acceptRepoLensStore,
  applyLenses,
  type LensFile,
  repoLensKey,
} from '../lenses.ts';
import {
  acceptLocalizationSettings,
  detectLocaleSources,
  type LocaleSource,
} from './config.ts';
import { readEntryLine, readFlatCatalogue } from './flatJson.ts';
import { detectLocalePatterns, matchLocalePath } from './localePaths.ts';
import { buildLocalizationModel } from './model.ts';
import { placeholderNames, tokenizeMessage } from './placeholders.ts';
import {
  isLocaleShown,
  localeChoices,
  showAllLocales,
  shownLocales,
  toggleShownLocale,
} from './shownLocales.ts';

// The catalogue hunks below are troph-team/lilja#778 as GitHub serves it: the
// same three keys added to every locale of one message directory, with three
// lines of context either side.

const DIR = 'apps/pixai-studio/messages';

function catalogueHunk(
  locale: string,
  start: number,
  context: [string, string, string, string, string, string],
  added: [string, string, string]
): string {
  return [
    `diff --git a/${DIR}/${locale}.json b/${DIR}/${locale}.json`,
    'index 1111111..2222222 100644',
    `--- a/${DIR}/${locale}.json`,
    `+++ b/${DIR}/${locale}.json`,
    `@@ -${String(start)},6 +${String(start)},9 @@`,
    ...context.slice(0, 3).map((line) => ` ${line}`),
    ...added.map((line) => `+${line}`),
    ...context.slice(3).map((line) => ` ${line}`),
  ].join('\n');
}

const EN_CONTEXT: [string, string, string, string, string, string] = [
  '  "canvas_import_assets_notice": "{assets} of {total} imported as assets",',
  '  "canvas_history_title": "Generation history",',
  '  "canvas_history_empty": "No generations yet",',
  '  "canvas_history_error": "Couldn\'t load history",',
  '  "canvas_history_view": "View",',
  '  "canvas_history_download": "Download",',
];

const PATCH = [
  catalogueHunk('en', 865, EN_CONTEXT, [
    '  "canvas_history_search_placeholder": "Search prompts",',
    '  "canvas_history_no_results": "No results for \\"{keyword}\\"",',
    '  "canvas_history_load_more": "Load more",',
  ]),
  catalogueHunk('ja', 793, EN_CONTEXT, [
    '  "canvas_history_search_placeholder": "プロンプトを検索",',
    '  "canvas_history_no_results": "「{keyword}」に一致する結果はありません",',
    '  "canvas_history_load_more": "さらに読み込む",',
  ]),
  catalogueHunk('zh', 793, EN_CONTEXT, [
    '  "canvas_history_search_placeholder": "搜尋提示詞",',
    '  "canvas_history_no_results": "沒有符合「{keyword}」的結果",',
    '  "canvas_history_load_more": "載入更多",',
  ]),
  catalogueHunk('key', 793, EN_CONTEXT, [
    '  "canvas_history_search_placeholder": "canvas_history_search_placeholder",',
    '  "canvas_history_no_results": "canvas_history_no_results",',
    '  "canvas_history_load_more": "canvas_history_load_more",',
  ]),
  catalogueHunk('pseudo', 865, EN_CONTEXT, [
    '  "canvas_history_search_placeholder": "⟦Šëàřçĥ ƥřõɱƥţšēēēēēē⟧",',
    '  "canvas_history_no_results": "⟦Ñõ řëšüļţš ƒõřēēēēēēē \\"{keyword}ē\\"⟧",',
    '  "canvas_history_load_more": "⟦Ļõàđ ɱõřëēēēē⟧",',
  ]),
  // Not from the pull request: a translator who dropped the placeholder, and
  // one who left the English in.
  catalogueHunk('de', 793, EN_CONTEXT, [
    '  "canvas_history_search_placeholder": "Prompts durchsuchen",',
    '  "canvas_history_no_results": "Keine Ergebnisse",',
    '  "canvas_history_load_more": "Load more",',
  ]),
  [
    'diff --git a/apps/pixai-studio/src/flow/history/tiles.ts b/apps/pixai-studio/src/flow/history/tiles.ts',
    'index 1111111..2222222 100644',
    '--- a/apps/pixai-studio/src/flow/history/tiles.ts',
    '+++ b/apps/pixai-studio/src/flow/history/tiles.ts',
    '@@ -1,2 +1,3 @@',
    ' export const a = 1;',
    '+export const b = 2;',
    ' export const c = 3;',
  ].join('\n'),
  '',
].join('\n');

function filesOf(patch: string): LensFile[] {
  const parsed = parsePatchFiles(patch, 'test');
  return parsed.flatMap((entry) =>
    entry.files.map((fileDiff) => ({
      itemId: fileDiff.name,
      path: fileDiff.name,
      fileDiff,
    }))
  );
}

describe('tokenizeMessage', () => {
  it('splits braces placeholders out of the prose', () => {
    assert.deepEqual(tokenizeMessage('No results for "{keyword}"', 'braces'), [
      { type: 'text', text: 'No results for "' },
      { type: 'placeholder', text: '{keyword}', name: 'keyword' },
      { type: 'text', text: '"' },
    ]);
  });

  it('keeps an ICU plural as one placeholder named by its argument', () => {
    const segments = tokenizeMessage(
      '{count, plural, one {# view} other {# views}} total',
      'braces'
    );
    assert.equal(segments[0]?.type, 'placeholder');
    assert.equal(segments.length, 2);
    assert.deepEqual(
      placeholderNames(
        '{count, plural, one {# view} other {# views}}',
        'braces'
      ),
      ['count']
    );
  });

  it('leaves a lone brace as text', () => {
    assert.deepEqual(placeholderNames('a { b', 'braces'), []);
    assert.deepEqual(placeholderNames('{not a name}', 'braces'), []);
  });

  it('reads double braces and printf', () => {
    assert.deepEqual(placeholderNames('Hi {{ user }}', 'double-braces'), [
      'user',
    ]);
    assert.deepEqual(placeholderNames('%s of %(total)d, %1$s', 'printf'), [
      '%s',
      '1',
      'total',
    ]);
  });
});

describe('matchLocalePath', () => {
  it('reads the locale out of a file name or a directory', () => {
    assert.equal(
      matchLocalePath(`${DIR}/ja.json`, `${DIR}/{locale}.json`),
      'ja'
    );
    assert.equal(
      matchLocalePath('locales/pt-BR/app.json', 'locales/{locale}/app.json'),
      'pt-BR'
    );
  });

  it('refuses anything that is not exactly the pattern', () => {
    assert.equal(
      matchLocalePath(`${DIR}/ja.yaml`, `${DIR}/{locale}.json`),
      undefined
    );
    assert.equal(
      matchLocalePath(`${DIR}/a/ja.json`, `${DIR}/{locale}.json`),
      undefined
    );
    assert.equal(
      matchLocalePath(`${DIR}/.json`, `${DIR}/{locale}.json`),
      undefined
    );
  });
});

describe('detectLocalePatterns', () => {
  it('finds one catalogue in a pull request that holds code as well', () => {
    const paths = filesOf(PATCH).map((file) => file.path);
    assert.deepEqual(detectLocalePatterns(paths), [
      {
        pattern: `${DIR}/{locale}.json`,
        locales: ['de', 'en', 'ja', 'key', 'pseudo', 'zh'],
      },
    ]);
  });

  it('needs three locales before two files are a catalogue', () => {
    assert.deepEqual(detectLocalePatterns(['src/id.json', 'src/it.json']), []);
  });

  it('fills in the base and the generated locales', () => {
    const [source] = detectLocaleSources(filesOf(PATCH).map((f) => f.path));
    assert.equal(source?.baseLocale, 'en');
    assert.deepEqual(source?.generatedLocales, ['key', 'pseudo']);
    assert.equal(source?.placeholders, 'braces');
  });
});

describe('readFlatCatalogue', () => {
  it('reads an escaped quote inside a value', () => {
    assert.deepEqual(readEntryLine('  "a": "say \\"{x}\\"",\n'), {
      key: 'a',
      value: 'say "{x}"',
      indent: 2,
    });
  });

  it('pairs a changed value by key, with both line numbers', () => {
    const [file] = filesOf(
      [
        'diff --git a/m/en.json b/m/en.json',
        '--- a/m/en.json',
        '+++ b/m/en.json',
        '@@ -2,3 +2,3 @@',
        '   "a": "A",',
        '-  "b": "Old",',
        '+  "b": "New",',
        '   "c": "C",',
        '',
      ].join('\n')
    );
    assert.ok(file != null);
    assert.deepEqual(readFlatCatalogue(file.fileDiff), [
      { key: 'b', old: 'Old', oldLine: 3, new: 'New', newLine: 3 },
    ]);
  });

  it('treats a comma added to the old last entry as no change', () => {
    const [file] = filesOf(
      [
        'diff --git a/m/en.json b/m/en.json',
        '--- a/m/en.json',
        '+++ b/m/en.json',
        '@@ -2,2 +2,3 @@',
        '-  "a": "A"',
        '+  "a": "A",',
        '+  "b": "B"',
        ' }',
        '',
      ].join('\n')
    );
    assert.ok(file != null);
    assert.deepEqual(readFlatCatalogue(file.fileDiff), [
      { key: 'b', new: 'B', newLine: 3 },
    ]);
  });

  it('refuses a change inside a nested message', () => {
    const [file] = filesOf(
      [
        'diff --git a/m/en.json b/m/en.json',
        '--- a/m/en.json',
        '+++ b/m/en.json',
        '@@ -2,4 +2,4 @@',
        '   "a": "A",',
        '   "views": [{',
        '-      "n=one": "{n} view",',
        '+      "n=one": "{n} viewing",',
        '',
      ].join('\n')
    );
    assert.ok(file != null);
    assert.equal(readFlatCatalogue(file.fileDiff), undefined);
  });
});

describe('buildLocalizationModel', () => {
  const files = filesOf(PATCH);
  const sources: LocaleSource[] = detectLocaleSources(files.map((f) => f.path));
  const model = buildLocalizationModel(files, sources);

  it('claims every catalogue file and leaves the code alone', () => {
    assert.equal(model.claimedItemIds.size, 6);
    assert.equal(
      model.claimedItemIds.has('apps/pixai-studio/src/flow/history/tiles.ts'),
      false
    );
  });

  it('turns eighteen added lines into three keys, base first', () => {
    const [group] = model.groups;
    assert.ok(group != null);
    assert.equal(group.label, DIR);
    assert.deepEqual(group.locales, ['en', 'de', 'ja', 'key', 'pseudo', 'zh']);
    assert.deepEqual(
      group.keys.map((key) => [key.key, key.kind]),
      [
        ['canvas_history_search_placeholder', 'added'],
        ['canvas_history_no_results', 'added'],
        ['canvas_history_load_more', 'added'],
      ]
    );
    const noResults = group.keys[1];
    assert.equal(
      noResults?.values.get('ja')?.new,
      '「{keyword}」に一致する結果はありません'
    );
    assert.equal(noResults?.values.get('en')?.newLine, 869);
  });

  it('names the dropped placeholder and the untranslated copy, and nothing else', () => {
    const issues = model.groups[0]?.keys.flatMap((key) =>
      key.issues.map((issue) => [
        key.key,
        issue.locale,
        issue.kind,
        issue.names,
      ])
    );
    assert.deepEqual(issues, [
      ['canvas_history_no_results', 'de', 'missing-placeholder', ['keyword']],
      ['canvas_history_load_more', 'de', 'same-as-base', undefined],
    ]);
  });
});

describe('shownLocales', () => {
  const files = filesOf(PATCH);
  const [group] = buildLocalizationModel(
    files,
    detectLocaleSources(files.map((f) => f.path))
  ).groups;
  assert.ok(group != null);

  it('reads every real language until the reviewer chooses', () => {
    assert.deepEqual(shownLocales(group, { enabled: true }), [
      'en',
      'de',
      'ja',
      'zh',
    ]);
  });

  it('offers every real language, the base first', () => {
    const choices = localeChoices([group]);
    assert.deepEqual(choices.readable, ['en', 'de', 'ja', 'zh']);
    assert.deepEqual([...choices.bases], ['en']);
  });

  it('turns one off on the first press, and never the base', () => {
    const choices = localeChoices([group]);
    const once = toggleShownLocale({ enabled: true }, choices, 'de');
    assert.deepEqual(once.shownLocales, ['en', 'ja', 'zh']);
    assert.equal(isLocaleShown('de', choices, once), false);
    assert.equal(toggleShownLocale(once, choices, 'en'), once);
    assert.equal(
      isLocaleShown('en', choices, { enabled: true, shownLocales: [] }),
      true
    );
    assert.deepEqual(shownLocales(group, { enabled: true, shownLocales: [] }), [
      'en',
    ]);
  });

  it('forgets the choice when every locale is on again', () => {
    assert.deepEqual(showAllLocales({ enabled: true, shownLocales: ['ja'] }), {
      enabled: true,
    });
  });
});

describe('the repository store', () => {
  it('keys a repository without case, and a local diff by its root', () => {
    assert.equal(
      repoLensKey({
        kind: 'github-pull',
        owner: 'Troph-Team',
        repo: 'Lilja',
        number: 1,
      }),
      'troph-team/lilja'
    );
    assert.equal(
      repoLensKey({
        kind: 'local-diff',
        root: '/w/app',
        range: { mode: 'worktree' },
      }),
      'local:/w/app'
    );
  });

  it('drops a bad source and keeps the rest of the setting', () => {
    assert.deepEqual(
      acceptLocalizationSettings({
        enabled: true,
        sources: [
          {
            pattern: 'no-token.json',
            format: 'flat-json',
            placeholders: 'braces',
            generatedLocales: [],
          },
          {
            pattern: 'm/{locale}.json',
            format: 'flat-json',
            placeholders: 'braces',
            baseLocale: 'en',
            generatedLocales: [],
          },
        ],
        shownLocales: ['en', 'ja'],
      }),
      {
        enabled: true,
        sources: [
          {
            pattern: 'm/{locale}.json',
            format: 'flat-json',
            placeholders: 'braces',
            baseLocale: 'en',
            generatedLocales: [],
          },
        ],
        shownLocales: ['en', 'ja'],
      }
    );
  });

  it('refuses what is not a store at all', () => {
    assert.equal(acceptRepoLensStore([]), undefined);
    assert.equal(acceptRepoLensStore('x'), undefined);
    assert.deepEqual(acceptRepoLensStore({ 'a/b': { localization: 7 } }), {
      'a/b': {},
    });
  });

  it('claims nothing for a repository that turned the lens off', () => {
    const applied = applyLenses(filesOf(PATCH), {
      localization: { enabled: false },
    });
    assert.equal(applied.claimedItemIds.size, 0);
  });
});
