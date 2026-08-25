import { parsePatchFiles } from '@pierre/diffs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  describeSynthesisGaps,
  type GitHubPullFile,
  synthesizePatch,
} from './githubPatch.ts';

function file(overrides: Partial<GitHubPullFile>): GitHubPullFile {
  return {
    filename: 'src/index.ts',
    status: 'modified',
    additions: 1,
    deletions: 1,
    ...overrides,
  };
}

const MODIFIED_PATCH = '@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three';

describe('synthesizePatch', () => {
  it('writes a modified file that @pierre/diffs can parse', () => {
    const { patch, fileCount } = synthesizePatch([
      file({ patch: MODIFIED_PATCH }),
    ]);
    assert.equal(fileCount, 1);

    const parsed = parsePatchFiles(patch, 'test-modified');
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].files.length, 1);
    assert.equal(parsed[0].files[0].name, 'src/index.ts');
    assert.equal(parsed[0].files[0].type, 'change');
    assert.equal(parsed[0].files[0].hunks.length, 1);
  });

  it('writes an added file', () => {
    const { patch } = synthesizePatch([
      file({
        filename: 'src/new.ts',
        status: 'added',
        deletions: 0,
        patch: '@@ -0,0 +1,2 @@\n+first\n+second',
      }),
    ]);
    assert.match(patch, /^diff --git a\/src\/new\.ts b\/src\/new\.ts$/m);
    assert.match(patch, /^new file mode 100644$/m);
    assert.match(patch, /^--- \/dev\/null$/m);

    const parsed = parsePatchFiles(patch, 'test-added');
    assert.equal(parsed[0].files[0].type, 'new');
    assert.equal(parsed[0].files[0].name, 'src/new.ts');
  });

  it('writes a removed file', () => {
    const { patch } = synthesizePatch([
      file({
        filename: 'src/old.ts',
        status: 'removed',
        additions: 0,
        patch: '@@ -1,2 +0,0 @@\n-first\n-second',
      }),
    ]);
    assert.match(patch, /^deleted file mode 100644$/m);
    assert.match(patch, /^\+\+\+ \/dev\/null$/m);

    const parsed = parsePatchFiles(patch, 'test-removed');
    assert.equal(parsed[0].files[0].type, 'deleted');
  });

  it('writes a rename that also changed content', () => {
    const { patch } = synthesizePatch([
      file({
        filename: 'src/after.ts',
        previous_filename: 'src/before.ts',
        status: 'renamed',
        patch: MODIFIED_PATCH,
      }),
    ]);
    assert.match(patch, /^diff --git a\/src\/before\.ts b\/src\/after\.ts$/m);
    assert.match(patch, /^similarity index 99%$/m);
    assert.match(patch, /^rename from src\/before\.ts$/m);
    assert.match(patch, /^rename to src\/after\.ts$/m);

    const parsed = parsePatchFiles(patch, 'test-rename-changed');
    assert.equal(parsed[0].files[0].name, 'src/after.ts');
    assert.equal(parsed[0].files[0].prevName, 'src/before.ts');
    assert.equal(parsed[0].files[0].type, 'rename-changed');
  });

  it('writes a pure rename with no hunks', () => {
    const { patch, filesWithoutPatch } = synthesizePatch([
      file({
        filename: 'src/after.ts',
        previous_filename: 'src/before.ts',
        status: 'renamed',
        additions: 0,
        deletions: 0,
      }),
    ]);
    assert.match(patch, /^similarity index 100%$/m);
    // A pure rename is complete without hunks, so it is not a gap.
    assert.deepEqual(filesWithoutPatch, []);

    const parsed = parsePatchFiles(patch, 'test-rename-pure');
    assert.equal(parsed[0].files[0].type, 'rename-pure');
    assert.equal(parsed[0].files[0].prevName, 'src/before.ts');
  });

  it('reports a file GitHub judged too large to diff', () => {
    const { patch, filesWithoutPatch } = synthesizePatch([
      file({ filename: 'data/huge.json', additions: 90000, deletions: 0 }),
    ]);
    assert.deepEqual(filesWithoutPatch, ['data/huge.json']);
    // The file still reaches the tree, with no hunks.
    const parsed = parsePatchFiles(patch, 'test-missing-patch');
    assert.equal(parsed[0].files.length, 1);
    assert.equal(parsed[0].files[0].name, 'data/huge.json');
    assert.equal(parsed[0].files[0].hunks.length, 0);
  });

  it('keeps the listed order across many files', () => {
    const names = ['a.ts', 'b.ts', 'c.ts', 'd.ts'];
    const { patch, fileCount } = synthesizePatch(
      names.map((name) => file({ filename: name, patch: MODIFIED_PATCH }))
    );
    assert.equal(fileCount, 4);
    const parsed = parsePatchFiles(patch, 'test-order');
    assert.deepEqual(
      parsed[0].files.map((entry) => entry.name),
      names
    );
  });

  it('strips only the trailing newlines GitHub omits', () => {
    const { patch } = synthesizePatch([
      file({ patch: `${MODIFIED_PATCH}\n\n` }),
    ]);
    assert.ok(patch.endsWith(' three\n'), patch.slice(-20));
    assert.ok(!patch.endsWith('\n\n'));
  });

  it('skips an entry with no filename', () => {
    const { fileCount } = synthesizePatch([file({ filename: '' })]);
    assert.equal(fileCount, 0);
  });

  it('handles an empty file list', () => {
    const result = synthesizePatch([]);
    assert.equal(result.patch, '');
    assert.equal(result.fileCount, 0);
  });
});

describe('describeSynthesisGaps', () => {
  it('says nothing when the fallback carried everything', () => {
    const result = synthesizePatch([file({ patch: MODIFIED_PATCH })]);
    assert.equal(describeSynthesisGaps(result, false), undefined);
  });

  it('names the one file it could not diff', () => {
    const result = synthesizePatch([file({ filename: 'big.json' })]);
    const note = describeSynthesisGaps(result, false);
    assert.match(note ?? '', /1 file too large/);
    assert.match(note ?? '', /big\.json/);
  });

  it('counts several files it could not diff', () => {
    const result = synthesizePatch([
      file({ filename: 'a.json' }),
      file({ filename: 'b.json' }),
    ]);
    assert.match(
      describeSynthesisGaps(result, false) ?? '',
      /2 files too large/
    );
  });

  it('reports a truncated file list', () => {
    const result = synthesizePatch([file({ patch: MODIFIED_PATCH })]);
    assert.match(describeSynthesisGaps(result, true) ?? '', /at most/);
  });
});
