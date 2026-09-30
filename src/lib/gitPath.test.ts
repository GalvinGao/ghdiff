import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isGitPatch, unquoteGitPath } from './gitPath.ts';
import { buildReviewData } from './reviewData.ts';

// Every fixture below is what `git diff` and `git show` printed for the same
// files, with the default `core.quotePath`, and not text written to match a
// reading of git's source.
const PRIVACY = String.raw`\343\203\227\343\203\251\343\202\244\343\203\220\343\202\267\343\203\274.md`;
const TERMS = String.raw`\350\246\217\347\264\204.md`;

describe('unquoteGitPath', () => {
  it('leaves a path git did not quote alone', () => {
    assert.equal(unquoteGitPath('src/lib/gitPath.ts'), 'src/lib/gitPath.ts');
    assert.equal(unquoteGitPath('docs/a b.md'), 'docs/a b.md');
  });

  it('reads octal escapes as the bytes of one UTF-8 character', () => {
    assert.equal(
      unquoteGitPath(`docs/legal/${PRIVACY}`),
      'docs/legal/プライバシー.md'
    );
  });

  it('reads the quoted shape a rename line keeps', () => {
    assert.equal(unquoteGitPath(`"${TERMS}"`), '規約.md');
  });

  it('reads the letter escapes, a quote and a backslash', () => {
    assert.equal(unquoteGitPath(String.raw`"tab\t\"q\".txt"`), 'tab\t"q".txt');
    assert.equal(unquoteGitPath(String.raw`"back\\slash"`), 'back\\slash');
    assert.equal(unquoteGitPath(String.raw`"line\nbreak"`), 'line\nbreak');
  });

  it('keeps a character that arrived unescaped beside one that did not', () => {
    // `core.quotePath=false` leaves UTF-8 as it is and still escapes a tab.
    assert.equal(unquoteGitPath(String.raw`"規約\t.md"`), '規約\t.md');
  });

  it('keeps a backslash git would not have written', () => {
    assert.equal(unquoteGitPath(String.raw`a\qb`), String.raw`a\qb`);
    assert.equal(unquoteGitPath('trailing\\'), 'trailing\\');
  });

  it('decodes a byte run that is not UTF-8 without throwing', () => {
    assert.equal(unquoteGitPath(String.raw`bad\377.txt`), 'bad�.txt');
  });
});

describe('isGitPatch', () => {
  it('knows git format by its file header', () => {
    assert.equal(isGitPatch('diff --git a/x b/x\n'), true);
    assert.equal(
      isGitPatch('From abc Mon Sep 17\n\ndiff --git a/x b/x\n'),
      true
    );
    assert.equal(isGitPatch('--- a/x\n+++ b/x\n@@ -1 +1 @@\n'), false);
  });
});

describe('buildReviewData with quoted paths', () => {
  it('names a new file by its real path', () => {
    const patch = [
      `diff --git "a/docs/legal/${PRIVACY}" "b/docs/legal/${PRIVACY}"`,
      'new file mode 100644',
      'index 0000000..7898192',
      '--- /dev/null',
      `+++ "b/docs/legal/${PRIVACY}"`,
      '@@ -0,0 +1 @@',
      '+a',
      '',
    ].join('\n');
    const { entries, items } = buildReviewData(patch, 'test');
    assert.equal(entries[0]?.path, 'docs/legal/プライバシー.md');
    assert.equal(entries[0]?.itemId, 'docs/legal/プライバシー.md');
    assert.equal(items[0]?.fileDiff.name, 'docs/legal/プライバシー.md');
  });

  it('names both sides of a rename', () => {
    const patch = [
      `diff --git "a/${PRIVACY}" "b/${TERMS}"`,
      'similarity index 100%',
      `rename from "${PRIVACY}"`,
      `rename to "${TERMS}"`,
      '',
    ].join('\n');
    const { entries } = buildReviewData(patch, 'test');
    assert.equal(entries[0]?.path, '規約.md');
    assert.equal(entries[0]?.previousPath, 'プライバシー.md');
  });

  it('matches an untracked path the command listed with -z', () => {
    const patch = [
      String.raw`diff --git "a/tab\t\"q\".txt" "b/tab\t\"q\".txt"`,
      'new file mode 100644',
      'index 0000000..587be6b',
      '--- /dev/null',
      String.raw`+++ "b/tab\t\"q\".txt"`,
      '@@ -0,0 +1 @@',
      '+x',
      '',
    ].join('\n');
    const { entries } = buildReviewData(
      patch,
      'test',
      new Set(['tab\t"q".txt'])
    );
    assert.equal(entries[0]?.status, 'untracked');
  });
});
