import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inspectCatalogs, inspectSource } from '../../scripts/check-i18n.mjs';
import { m } from '../paraglide/messages.js';
import {
  cookieName,
  getLocale,
  getUrlOrigin,
  locales,
} from '../paraglide/runtime.js';
import { paraglideMiddleware } from '../paraglide/server.js';
import { describeInstallationReach } from './installations.ts';
import { textDirection } from './locale.ts';

test('compiled counts distinguish zero, one, other, and formatted large values', () => {
  assert.equal(m.common_file_count({ count: 0 }), '0 files');
  assert.equal(m.common_file_count({ count: 1 }), '1 file');
  assert.equal(m.common_file_count({ count: 2 }), '2 files');
  assert.equal(m.common_file_count({ count: 1000 }), '1,000 files');
  assert.equal(m.diff_unmodified_lines({ count: 1 }), '1 unmodified line');
  assert.equal(m.diff_unmodified_lines({ count: 2 }), '2 unmodified lines');
});

test('both selectors participate in the thread summary', () => {
  for (const [threadCount, commentCount, expected] of [
    [1, 1, '1 thread, 1 comment'],
    [1, 2, '1 thread, 2 comments'],
    [2, 1, '2 threads, 1 comment'],
    [2, 2, '2 threads, 2 comments'],
  ] as const)
    assert.equal(
      m.review_sidebar_threads_comments({ threadCount, commentCount }),
      expected
    );
});

test('semantic zero and one states retain their meaning and required values', () => {
  const installation = {
    id: 1,
    account: 'example',
    settingsUrl: '',
    allRepositories: false,
  };
  assert.equal(
    describeInstallationReach(installation),
    m.installations_no_repositories_selected()
  );
  assert.equal(
    describeInstallationReach({ ...installation, allRepositories: true }),
    m.installations_all_repositories()
  );
  assert.match(
    m.github_patch_missing_files({ count: 1, path: 'owner/file.ts' }),
    /owner\/file\.ts/
  );
  assert.doesNotMatch(
    m.github_patch_missing_files({ count: 2, path: 'owner/file.ts' }),
    /owner\/file\.ts/
  );
  assert.equal(
    m.thread_delete_confirmation({ count: 1 }),
    'Delete this comment on GitHub? This cannot be undone.'
  );
  assert.match(m.thread_delete_confirmation({ count: 2 }), /2 comments/);
});

test('rich messages retain markup and opaque interpolation as text', () => {
  const target = '<img src=x onerror=alert(1)>';
  const parts = m.review_submit_scope.parts({ target });
  assert.ok(
    parts.some((part) => part.type === 'markup-start' && part.name === 'strong')
  );
  assert.ok(
    parts.some((part) => part.type === 'text' && part.value === target)
  );
  assert.deepEqual(
    m.home_credits
      .parts({})
      .filter((part) => part.type === 'markup-start')
      .map((part) => part.name),
    ['diffs', 'trees']
  );
});

test('source checks reject literals and import-time calls but allow lazy labels', () => {
  assert.equal(
    inspectSource(
      'const x = <button title="Delete">Delete</button>',
      'sample.tsx'
    ).length,
    2
  );
  assert.equal(inspectSource('const label = m.label()', 'sample.ts').length, 1);
  assert.equal(
    inspectSource(
      'const item = { get label() { return m.label() } }',
      'sample.ts'
    ).length,
    0
  );
  assert.equal(
    inspectSource(
      'function X() { return <button title={m.title()}>{m.label()}</button> }',
      'sample.tsx'
    ).length,
    0
  );
});

test('catalog checks recognize a full catch-all and reject broken structure', () => {
  assert.ok(
    inspectCatalogs(
      {
        en: { greeting: 'Hello {name}' },
        de: { greeting: 'Hallo {name} {name}' },
      },
      'en'
    ).some((error) => error.includes('repeated or extra token'))
  );
  assert.ok(
    inspectCatalogs(
      { en: { greeting: '{#strong}{#link}Hello{/strong}{/link}' } },
      'en'
    ).some((error) => error.includes('mismatched rich-text markup'))
  );
  assert.ok(
    inspectCatalogs(
      { en: { greeting: 'Hello {name}' }, ja: { greeting: 'こんにちは' } },
      'en'
    ).some((error) => error.includes('interpolation or markup'))
  );
  assert.deepEqual(
    inspectCatalogs(
      {
        en: { greeting: '{#strong}{name}{/strong}' },
        ja: { greeting: '{#strong}{name}{/strong}さん' },
      },
      'en'
    ),
    []
  );
  const valid = [
    {
      declarations: ['input count', 'local category = count: plural'],
      selectors: ['category'],
      match: { 'category=one': '{count} file', 'category=*': '{count} files' },
    },
  ];
  assert.deepEqual(inspectCatalogs({ en: { count: valid } }, 'en'), []);
  assert.ok(inspectCatalogs({ en: { count: valid }, fr: {} }, 'en').length > 0);
  assert.ok(
    inspectCatalogs(
      {
        en: {
          count: [{ ...valid[0], match: { 'category=one': '{missing}' } }],
        },
      },
      'en'
    ).length > 0
  );
  assert.ok(
    inspectCatalogs(
      {
        en: {
          count: [
            {
              ...valid[0],
              match: { 'category=*': 'files', 'category=one': 'file' },
            },
          ],
        },
      },
      'en'
    ).length > 0
  );
});

test('request-scoped locale context survives interleaved asynchronous handlers', async () => {
  let unblock: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const first = paraglideMiddleware(
    new Request('https://first.example/a/b/pull/1', {
      headers: { cookie: `${cookieName}=en` },
    }),
    async () => {
      await gate;
      assert.equal(getLocale(), 'en');
      assert.equal(getUrlOrigin(), 'https://first.example');
      return new Response('first');
    }
  );
  const secondLocale = locales.find((locale) => locale !== 'en') ?? 'en';
  const second = paraglideMiddleware(
    new Request('https://second.example/a/b/pull/2', {
      headers: { cookie: `${cookieName}=${secondLocale}` },
    }),
    async () => {
      assert.equal(getUrlOrigin(), 'https://second.example');
      assert.equal(getLocale(), secondLocale);
      assert.equal(
        m.locale_language(),
        m.locale_language({}, { locale: secondLocale })
      );
      unblock();
      return new Response('second');
    }
  );
  assert.deepEqual(
    await Promise.all([first, second]).then((responses) =>
      Promise.all(responses.map((response) => response.text()))
    ),
    ['first', 'second']
  );
});

test('document direction is derived from the locale without changing code content', () => {
  assert.equal(textDirection('ar'), 'rtl');
  assert.equal(textDirection('fa-IR'), 'rtl');
  assert.equal(textDirection('en'), 'ltr');
});

test('Pierre labels are transformed in build and versioned development modules', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { pierreI18n } = await import('../../scripts/pierre-i18n.mjs');
  const transform = pierreI18n().transform;
  assert.equal(typeof transform, 'function');
  if (typeof transform !== 'function') throw new Error('Missing transform');
  for (const [pkg, relative, key] of [
    ['@pierre/diffs', './utils/createSeparator.js', 'diff_expand_all'],
    ['@pierre/diffs', './utils/createNoNewlineElement.js', 'diff_no_newline'],
    [
      '@pierre/diffs',
      './renderers/DiffHunksRenderer.js',
      'diff_unmodified_lines',
    ],
    ['@pierre/trees', './utils/gitStatusPresentation.js', 'tree_git_added'],
    ['@pierre/trees', './render/FileTreeView.js', 'tree_git_contains_changes'],
  ]) {
    const path = fileURLToPath(new URL(relative, import.meta.resolve(pkg)));
    const source = await readFile(path, 'utf8');
    for (const suffix of ['', '?v=cache-version']) {
      const result: { code: string } | undefined = await Reflect.apply(
        transform,
        {},
        [source, path + suffix]
      );
      assert.ok(result?.code.includes(`m.${key}(`), `${relative}${suffix}`);
    }
    assert.throws(
      () => Reflect.apply(transform, {}, ['', path]),
      /Update the ghdiff i18n adapter/
    );
  }
});

test('browser locale matching handles regions without changing Chinese scripts', async () => {
  const { matchLocale } = await import('./matchLocale.ts');
  const available = ['en', 'ja', 'zh-Hans', 'pt-BR'] as const;
  assert.equal(matchLocale('ja-JP', available), 'ja');
  assert.equal(matchLocale('zh-CN', available), 'zh-Hans');
  assert.equal(matchLocale('zh-TW', available), undefined);
  assert.equal(matchLocale('pt-BR', available), 'pt-BR');
  assert.equal(matchLocale('en-GB', available), 'en');
  assert.equal(matchLocale('not a language', available), undefined);
});

test('every enabled catalog renders its messages and representative count branches', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = JSON.parse(
    await readFile(new URL('../../messages/en.json', import.meta.url), 'utf8')
  );
  const counts = [0, 1, 2, 3, 5, 11, 21, 100, 101, 1000, 1000000];
  const compiled = new Map(Object.entries(m));
  for (const [key, value] of Object.entries(source)) {
    if (key === '$schema') continue;
    const serialized = JSON.stringify(value);
    const inputs: Record<string, string | number> = Object.fromEntries(
      [...serialized.matchAll(/\{(\w+)\}/g)].map((match) => [
        match[1],
        'owner/repository',
      ])
    );
    const numeric = [
      ...serialized.matchAll(/local \w+ = (\w+): (?:plural|number)/g),
    ].map((match) => match[1]);
    const fn = compiled.get(key) as (
      input: Record<string, string | number>,
      options: { locale: (typeof locales)[number] }
    ) => string;
    for (const locale of locales) {
      for (const count of Array.isArray(value) ? counts : [1]) {
        for (const name of numeric) inputs[name] = count;
        const output = fn(inputs, { locale });
        assert.equal(typeof output, 'string', `${locale}.${key}`);
        assert.ok(output.length > 0, `${locale}.${key}`);
        assert.ok(!output.includes('undefined'), `${locale}.${key}: ${output}`);
      }
    }
  }
  for (const locale of locales) {
    for (const count of [21, 101]) {
      assert.ok(
        m
          .thread_delete_confirmation({ count }, { locale })
          .includes(new Intl.NumberFormat(locale).format(count)),
        `${locale}: a grammatical singular must not mean exactly one comment`
      );
    }
  }
});
