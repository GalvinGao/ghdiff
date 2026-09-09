import { compile } from '@inlang/paraglide-js';
import { readFile } from 'node:fs/promises';

import { i18nConfig } from '../i18n.config.mjs';

await compile(i18nConfig);

// The SDK reports some import failures as warnings. Never let an empty or
// partial generated catalog pass the build just because compilation returned.
const source = JSON.parse(await readFile('messages/en.json', 'utf8'));
const { m } = await import('../src/paraglide/messages.js');
const expected = Object.keys(source)
  .filter((key) => key !== '$schema')
  .sort();
if (JSON.stringify(Object.keys(m).sort()) !== JSON.stringify(expected)) {
  throw new Error(
    'Compiled Paraglide messages do not match the source catalog'
  );
}
