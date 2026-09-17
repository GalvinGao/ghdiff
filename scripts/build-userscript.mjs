import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'vite';

import { m } from '../src/paraglide/messages.js';

const source = await readFile('src/userscript.js', 'utf8');
const metadata = source
  .slice(0, source.indexOf('// ==/UserScript==') + '// ==/UserScript=='.length)
  .replace(
    /^\/\/ @description .*$/m,
    `// @description  ${m.userscript_description({}, { locale: 'en' })}`
  );
const result = await build({
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    write: false,
    minify: false,
    lib: {
      entry: 'src/userscript.js',
      formats: ['iife'],
      name: 'ghdiffUserscript',
    },
  },
});
const output = Array.isArray(result) ? result[0] : result;
if (!('output' in output))
  throw new Error('Userscript build produced no output');
const chunk = output.output.find(
  (item) => item.type === 'chunk' && item.isEntry
);
if (!chunk) throw new Error('Userscript build produced no entry chunk');
await writeFile(
  'public/ghdiff.user.js',
  `${metadata}\n\n// Generated from src/userscript.js and messages/en.json.\n${chunk.code}`
);
