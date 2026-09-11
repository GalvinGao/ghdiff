import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isReadablePath } from './filePath.ts';

describe('isReadablePath', () => {
  it('takes an ordinary path, and one with a space in it', () => {
    assert.equal(isReadablePath('src/lib/reviewTarget.ts'), true);
    assert.equal(isReadablePath('docs/design notes.md'), true);
    assert.equal(isReadablePath('.github/workflows/ci.yml'), true);
  });

  it('takes the bytes git allows in a path and GitHub serves', () => {
    // Verified against git itself: a tree entry may hold any byte but NUL, and
    // `git show`, `git cat-file -s` and `git diff --no-index` all answer for
    // these. Refusing one would refuse to expand a file the diff just drew —
    // and the untracked list is read with `-z` precisely because a path is
    // allowed to contain a newline.
    assert.equal(isReadablePath('src/weird\nname.ts'), true);
    assert.equal(isReadablePath('src/tab\tname.ts'), true);
    assert.equal(
      isReadablePath(`src/del${String.fromCharCode(0x7f)}.ts`),
      true
    );
    assert.equal(isReadablePath('src/café/ünïcode.ts'), true);
    assert.equal(isReadablePath('src/emoji-🎉.ts'), true);
  });

  it('refuses the segments a path would climb out with', () => {
    assert.equal(isReadablePath('../etc/passwd'), false);
    assert.equal(isReadablePath('src/../../etc/passwd'), false);
    assert.equal(isReadablePath('src/./a.ts'), false);
    assert.equal(isReadablePath('/etc/passwd'), false);
    assert.equal(isReadablePath('src//a.ts'), false);
  });

  it('refuses the empty path, an absurd one, and the one byte no path holds', () => {
    assert.equal(isReadablePath(''), false);
    assert.equal(isReadablePath('a'.repeat(1025)), false);
    // NUL ends a C string, so it would truncate an argument vector, and it is
    // what `-z` puts between paths.
    assert.equal(isReadablePath(`src/a${String.fromCharCode(0)}.ts`), false);
  });
});
