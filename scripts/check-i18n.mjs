import { parse } from '@babel/parser';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const visibleAttributes = new Set([
  'title',
  'aria-label',
  'aria-description',
  'alt',
  'placeholder',
  'label',
  'confirmLabel',
  'pendingLabel',
  'question',
  'description',
]);
// Exact protected product names, code examples, and opaque identifiers.
const protectedText = new Set([
  'ghdiff',
  'ghdiff.com',
  'github',
  'GitHub',
  'CodeView',
  'FileTree',
  'Tampermonkey',
  '@imgggalvin',
  '.com/owner/repo/pull/123',
]);

export function inspectSource(source, filename) {
  const errors = [];
  const ast = parse(source, {
    sourceType: 'module',
    plugins: filename.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'],
  });
  function visit(node, parents) {
    if (!node?.type) return;
    const parent = parents.at(-1);
    if (
      node.type === 'JSXText' &&
      /[A-Za-z]/.test(node.value) &&
      !protectedText.has(node.value.trim())
    ) {
      errors.push(`${filename}:${node.loc.start.line}: literal JSX text`);
    }
    if (
      node.type === 'StringLiteral' &&
      parent?.type === 'JSXAttribute' &&
      visibleAttributes.has(parent.name.name) &&
      /[A-Za-z]/.test(node.value) &&
      !protectedText.has(node.value) &&
      !/^https?:\/\//.test(node.value)
    ) {
      errors.push(
        `${filename}:${node.loc.start.line}: literal ${parent.name.name}`
      );
    }
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      node.callee.object.name === 'm' &&
      !parents.some((item) => /Function|Method/.test(item.type))
    ) {
      errors.push(
        `${filename}:${node.loc.start.line}: message evaluated at module initialization`
      );
    }
    for (const [key, value] of Object.entries(node)) {
      if (
        [
          'loc',
          'comments',
          'leadingComments',
          'trailingComments',
          'innerComments',
          'tokens',
        ].includes(key)
      )
        continue;
      if (Array.isArray(value))
        value.forEach((child) => visit(child, [...parents, node]));
      else if (value?.type) visit(value, [...parents, node]);
    }
  }
  visit(ast, []);
  return errors;
}

export function inspectCatalogs(catalogs, baseLocale) {
  const errors = [];
  const keys = Object.keys(catalogs[baseLocale]).filter(
    (key) => key !== '$schema'
  );
  for (const [locale, catalog] of Object.entries(catalogs)) {
    const actual = Object.keys(catalog).filter((key) => key !== '$schema');
    if (actual.join('\n') !== keys.join('\n'))
      errors.push(`${locale}: keys or key order differ from ${baseLocale}`);
    for (const key of keys) {
      const value = catalog[key];
      const source = catalogs[baseLocale][key];
      for (const text of messageTexts(value)) {
        const stack = [];
        for (const [, direction, name] of text.matchAll(/\{([#/])(\w+)\}/g)) {
          if (direction === '#') stack.push(name);
          else if (stack.pop() !== name)
            errors.push(`${locale}.${key}: mismatched rich-text markup`);
        }
        if (stack.length)
          errors.push(`${locale}.${key}: unclosed rich-text markup`);
      }
      if (locale !== baseLocale) {
        const maximumOccurrences = new Map();
        for (const text of messageTexts(source)) {
          const counts = countTokens(text);
          for (const [token, count] of counts)
            maximumOccurrences.set(
              token,
              Math.max(maximumOccurrences.get(token) ?? 0, count)
            );
        }
        for (const text of messageTexts(value)) {
          for (const [token, count] of countTokens(text)) {
            if (count > (maximumOccurrences.get(token) ?? 0))
              errors.push(`${locale}.${key}: repeated or extra token ${token}`);
          }
        }
        for (const brand of ['GitHub', 'ghdiff']) {
          if (
            messageTexts(source).every((text) => text.includes(brand)) &&
            messageTexts(value).some((text) => !text.includes(brand))
          )
            errors.push(
              `${locale}.${key}: missing protected name ${brand} in a branch`
            );
        }
        if (
          JSON.stringify(messageTokens(value)) !==
          JSON.stringify(messageTokens(source))
        )
          errors.push(
            `${locale}.${key}: interpolation or markup tokens differ from ${baseLocale}`
          );
      }
      if (typeof value === 'string') {
        if (!value.trim()) errors.push(`${locale}.${key}: empty message`);
        continue;
      }
      if (!Array.isArray(value) || value.length === 0) {
        errors.push(`${locale}.${key}: missing or unsupported message`);
        continue;
      }
      for (const variant of value) {
        if (
          !variant ||
          !Array.isArray(variant.declarations) ||
          !Array.isArray(variant.selectors) ||
          !variant.match ||
          typeof variant.match !== 'object'
        ) {
          errors.push(`${locale}.${key}: invalid variant`);
          continue;
        }
        const arms = Object.keys(variant.match);
        const catchAll = arms.findIndex((arm) => {
          const conditions = Object.fromEntries(
            arm.split(',').map((condition) => condition.trim().split('='))
          );
          return variant.selectors.every(
            (selector) => conditions[selector] === '*'
          );
        });
        if (catchAll !== arms.length - 1 || catchAll < 0)
          errors.push(
            `${locale}.${key}: final catch-all missing or unreachable arms`
          );
        const declared = new Set(
          variant.declarations.map(
            (declaration) => /^(?:input|local)\s+(\w+)/.exec(declaration)?.[1]
          )
        );
        for (const text of Object.values(variant.match)) {
          if (typeof text !== 'string' || !text.trim()) {
            errors.push(`${locale}.${key}: invalid branch text`);
            continue;
          }
          for (const match of text.matchAll(/\{(\w+)\}/g)) {
            if (!declared.has(match[1]))
              errors.push(
                `${locale}.${key}: undeclared placeholder ${match[1]}`
              );
          }
        }
      }
    }
  }
  return errors;
}

// Compare the whole message, not the union required in each plural branch:
// semantic branches may deliberately omit values (for example a file path).
function messageTokens(value) {
  const texts = messageTexts(value);
  return [
    ...new Set(
      texts.flatMap((text) =>
        [...text.matchAll(/\{([#/]?\w+)\}/g)].map((match) => match[1])
      )
    ),
  ].sort();
}

function countTokens(text) {
  const counts = new Map();
  for (const [, token] of text.matchAll(/\{([#/]?\w+)\}/g))
    counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

function messageTexts(value) {
  return (
    typeof value === 'string'
      ? [value]
      : Array.isArray(value)
        ? value.flatMap((variant) => Object.values(variant?.match ?? {}))
        : []
  ).filter((text) => typeof text === 'string');
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    if (entry.isDirectory())
      return entry.name === 'paraglide' ? [] : sourceFiles(file);
    return /\.(?:ts|tsx|js)$/.test(file) &&
      !file.endsWith('.test.ts') &&
      !file.endsWith('routeTree.gen.ts')
      ? [file]
      : [];
  });
}

export function checkI18n() {
  const settings = JSON.parse(
    readFileSync('project.inlang/settings.json', 'utf8')
  );
  const catalogs = Object.fromEntries(
    settings.locales.map((locale) => [
      locale,
      JSON.parse(readFileSync(`messages/${locale}.json`, 'utf8')),
    ])
  );
  return [
    ...inspectCatalogs(catalogs, settings.baseLocale),
    ...sourceFiles('src').flatMap((file) =>
      inspectSource(readFileSync(file, 'utf8'), file)
    ),
  ];
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const errors = checkI18n();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else
    console.log(
      'i18n catalog structure, JSX text, accessibility attributes, and lazy message calls passed.'
    );
}
