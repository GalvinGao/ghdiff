import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ReviewFileEntry } from './reviewData.ts';
import { buildTreeStatIndex } from './treeStats.ts';

function entry(overrides: Partial<ReviewFileEntry>): ReviewFileEntry {
  const path = overrides.path ?? 'src/index.ts';
  return {
    itemId: path,
    path,
    treePath: path,
    fileOrder: 0,
    changeType: 'change',
    status: 'modified',
    addedLines: 0,
    deletedLines: 0,
    ...overrides,
  };
}

describe('buildTreeStatIndex', () => {
  it('gives a file its own counts', () => {
    const index = buildTreeStatIndex([
      entry({ path: 'a.ts', addedLines: 3, deletedLines: 1 }),
    ]);
    assert.deepEqual(index.byPath.get('a.ts'), {
      addedLines: 3,
      deletedLines: 1,
      fileCount: 1,
    });
  });

  it('keys a directory with the trailing slash the tree uses', () => {
    const index = buildTreeStatIndex([
      entry({ path: 'src/a.ts', addedLines: 2, deletedLines: 0 }),
    ]);
    assert.equal(index.byPath.has('src'), false);
    assert.equal(index.byPath.get('src/')?.fileCount, 1);
    assert.equal(index.byPath.get('src/a.ts')?.fileCount, 1);
  });

  it('sums every descendant into each directory above it', () => {
    const index = buildTreeStatIndex([
      entry({ path: 'src/a/one.ts', addedLines: 5, deletedLines: 2 }),
      entry({ path: 'src/a/two.ts', addedLines: 7, deletedLines: 0 }),
      entry({ path: 'src/b/three.ts', addedLines: 1, deletedLines: 1 }),
    ]);
    assert.deepEqual(index.byPath.get('src/'), {
      addedLines: 13,
      deletedLines: 3,
      fileCount: 3,
    });
    assert.deepEqual(index.byPath.get('src/a/'), {
      addedLines: 12,
      deletedLines: 2,
      fileCount: 2,
    });
    assert.deepEqual(index.byPath.get('src/b/'), {
      addedLines: 1,
      deletedLines: 1,
      fileCount: 1,
    });
  });

  it('indexes the tree path, which carries a commit prefix', () => {
    const index = buildTreeStatIndex([
      entry({
        path: 'a.ts',
        treePath: 'abc1234/a.ts',
        addedLines: 4,
        deletedLines: 0,
      }),
    ]);
    assert.equal(index.byPath.has('a.ts'), false);
    assert.equal(index.byPath.get('abc1234/a.ts')?.addedLines, 4);
    assert.equal(index.byPath.get('abc1234/')?.addedLines, 4);
  });

  it('sizes each column from the widest number, which is a directory total', () => {
    const index = buildTreeStatIndex([
      entry({ path: 'src/one.ts', addedLines: 60, deletedLines: 4 }),
      entry({ path: 'src/two.ts', addedLines: 60, deletedLines: 5 }),
    ]);
    // 120 added across the directory, 9 deleted.
    assert.equal(index.addedDigits, 3);
    assert.equal(index.deletedDigits, 1);
  });

  it('reports one digit for an empty diff', () => {
    const index = buildTreeStatIndex([]);
    assert.equal(index.addedDigits, 1);
    assert.equal(index.deletedDigits, 1);
    assert.equal(index.byPath.size, 0);
  });
});
