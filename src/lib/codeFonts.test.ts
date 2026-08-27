import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CODE_FONTS,
  codeFontStack,
  codeFontStacks,
  DEFAULT_CODE_FONT,
  isCodeFont,
} from './codeFonts.ts';

test('the platform face is first, and it is the default', () => {
  assert.equal(CODE_FONTS[0]?.id, 'system');
  assert.equal(DEFAULT_CODE_FONT, 'system');
});

test('every id is distinct', () => {
  const ids = CODE_FONTS.map((font) => font.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every stack ends in the system property', () => {
  // A face that fails to download has to leave a monospace behind it, and the
  // system stack itself is written in one place only.
  for (const font of CODE_FONTS) {
    assert.ok(
      font.stack.endsWith('var(--app-font-mono-system)'),
      `${font.id} does not fall back to the system stack`
    );
  }
});

test('the system choice is the fallback and nothing else', () => {
  assert.equal(CODE_FONTS[0]?.stack, 'var(--app-font-mono-system)');
});

test('isCodeFont accepts every id and nothing else', () => {
  for (const font of CODE_FONTS) assert.ok(isCodeFont(font.id));
  assert.equal(isCodeFont('helvetica'), false);
  assert.equal(isCodeFont(''), false);
  assert.equal(isCodeFont(null), false);
});

test('an unrecognized stored value reads as the system stack', () => {
  assert.equal(codeFontStack('comic-sans'), codeFontStack('system'));
  assert.equal(codeFontStack(null), codeFontStack('system'));
});

test('a named face resolves to its own family first', () => {
  assert.match(codeFontStack('jetbrains'), /^'JetBrains Mono Variable', /);
});

test('the script map covers every choice', () => {
  const stacks = codeFontStacks();
  assert.equal(Object.keys(stacks).length, CODE_FONTS.length);
  for (const font of CODE_FONTS) assert.equal(stacks[font.id], font.stack);
});
