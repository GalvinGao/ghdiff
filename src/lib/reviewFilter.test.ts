import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ReviewData, ReviewFileEntry } from './reviewData.ts';
import {
  applyReviewFilter,
  availableStatuses,
  EMPTY_FILTER_STATE,
  isFilterActive,
  presetStats,
  type ReviewFilterState,
} from './reviewFilter.ts';

function entry(
  path: string,
  status: ReviewFileEntry['status'],
  fileOrder: number
): ReviewFileEntry {
  return {
    itemId: path,
    path,
    treePath: path,
    fileOrder,
    changeType: status === 'added' ? 'new' : 'change',
    status,
    addedLines: 1,
    deletedLines: 0,
  };
}

const PATHS: [string, ReviewFileEntry['status']][] = [
  ['src/index.ts', 'modified'],
  ['src/index.test.ts', 'added'],
  ['src/util/parse.ts', 'modified'],
  ['test/e2e/login.ts', 'added'],
  ['README.md', 'modified'],
  ['package.json', 'modified'],
  ['pnpm-lock.yaml', 'modified'],
  ['old/legacy.ts', 'deleted'],
];

const data: ReviewData = {
  entries: PATHS.map(([path, status], index) => entry(path, status, index)),
  items: PATHS.map(([path]) => ({
    id: path,
    type: 'diff' as const,
    // The filter reads the id and the unified line count, so a stub with
    // those two is enough here.
    fileDiff: { name: path, unifiedLineCount: 1 } as never,
    version: 0,
  })),
  stats: {
    addedLines: 8,
    deletedLines: 0,
    fileCount: PATHS.length,
    totalLines: 8,
  },
};

function paths(state: ReviewFilterState): string[] {
  return applyReviewFilter(data, state).entries.map((item) => item.path);
}

describe('applyReviewFilter', () => {
  it('keeps every file with the default state', () => {
    const result = applyReviewFilter(data, EMPTY_FILTER_STATE);
    assert.equal(result.entries.length, PATHS.length);
    assert.equal(result.items.length, PATHS.length);
    assert.equal(result.hiddenCount, 0);
  });

  it('hides tests', () => {
    assert.deepEqual(
      paths({ ...EMPTY_FILTER_STATE, presetId: 'without-tests' }),
      [
        'src/index.ts',
        'src/util/parse.ts',
        'README.md',
        'package.json',
        'pnpm-lock.yaml',
        'old/legacy.ts',
      ]
    );
  });

  it('shows tests only', () => {
    assert.deepEqual(paths({ ...EMPTY_FILTER_STATE, presetId: 'tests' }), [
      'src/index.test.ts',
      'test/e2e/login.ts',
    ]);
  });

  it('shows source only', () => {
    assert.deepEqual(paths({ ...EMPTY_FILTER_STATE, presetId: 'source' }), [
      'src/index.ts',
      'src/util/parse.ts',
      'old/legacy.ts',
    ]);
  });

  it('reports how many files it removed', () => {
    const result = applyReviewFilter(data, {
      ...EMPTY_FILTER_STATE,
      presetId: 'tests',
    });
    assert.equal(result.hiddenCount, PATHS.length - 2);
  });

  it('combines a preset with a status filter', () => {
    assert.deepEqual(
      paths({
        ...EMPTY_FILTER_STATE,
        presetId: 'without-tests',
        statuses: new Set(['deleted']),
      }),
      ['old/legacy.ts']
    );
  });

  it('combines a preset with a path query', () => {
    assert.deepEqual(
      paths({ ...EMPTY_FILTER_STATE, presetId: 'source', query: 'util' }),
      ['src/util/parse.ts']
    );
  });

  it('matches the query without regard to case', () => {
    assert.deepEqual(paths({ ...EMPTY_FILTER_STATE, query: 'README' }), [
      'README.md',
    ]);
    assert.deepEqual(paths({ ...EMPTY_FILTER_STATE, query: 'readme' }), [
      'README.md',
    ]);
  });

  it('keeps the diff order of the patch', () => {
    const result = paths({
      ...EMPTY_FILTER_STATE,
      presetId: 'without-generated',
    });
    assert.deepEqual(
      result,
      PATHS.map(([path]) => path).filter((path) => path !== 'pnpm-lock.yaml')
    );
  });

  it('projects a tree source that matches the kept items', () => {
    const result = applyReviewFilter(data, {
      ...EMPTY_FILTER_STATE,
      presetId: 'tests',
    });
    assert.deepEqual(result.treeSource.paths, [
      'src/index.test.ts',
      'test/e2e/login.ts',
    ]);
    assert.deepEqual(result.treeSource.gitStatus, [
      { path: 'src/index.test.ts', status: 'added' },
      { path: 'test/e2e/login.ts', status: 'added' },
    ]);
    assert.equal(
      result.treeSource.itemIdByPath.get('src/index.test.ts'),
      'src/index.test.ts'
    );
  });

  it('can filter everything out', () => {
    const result = applyReviewFilter(data, {
      ...EMPTY_FILTER_STATE,
      query: 'no-such-path',
    });
    assert.equal(result.entries.length, 0);
    assert.equal(result.hiddenCount, PATHS.length);
    assert.deepEqual(result.stats, {
      addedLines: 0,
      deletedLines: 0,
      fileCount: 0,
      totalLines: 0,
    });
  });

  it('reports the stats of the whole patch when nothing is filtered', () => {
    const result = applyReviewFilter(data, EMPTY_FILTER_STATE);
    assert.deepEqual(result.stats, {
      addedLines: PATHS.length,
      deletedLines: 0,
      fileCount: PATHS.length,
      totalLines: PATHS.length,
    });
  });

  it('reports the stats of the files it kept, not of the patch', () => {
    const result = applyReviewFilter(data, {
      ...EMPTY_FILTER_STATE,
      query: 'src/',
    });
    assert.equal(result.stats.fileCount, 3);
    assert.equal(result.stats.addedLines, 3);
    assert.equal(result.stats.totalLines, 3);
  });
});

describe('isFilterActive', () => {
  it('is false for the default state', () => {
    assert.equal(isFilterActive(EMPTY_FILTER_STATE), false);
  });

  it('is true once any axis narrows the list', () => {
    assert.equal(
      isFilterActive({ ...EMPTY_FILTER_STATE, presetId: 'tests' }),
      true
    );
    assert.equal(
      isFilterActive({ ...EMPTY_FILTER_STATE, statuses: new Set(['added']) }),
      true
    );
    assert.equal(isFilterActive({ ...EMPTY_FILTER_STATE, query: 'x' }), true);
    // It hides files, so the control that opens the menu has to say so — and
    // Clear filters has to be able to put it back.
    assert.equal(
      isFilterActive({ ...EMPTY_FILTER_STATE, hideUntracked: true }),
      true
    );
  });

  it('ignores a query of only spaces', () => {
    assert.equal(
      isFilterActive({ ...EMPTY_FILTER_STATE, query: '   ' }),
      false
    );
  });
});

describe('availableStatuses', () => {
  it('lists only the statuses this diff contains', () => {
    assert.deepEqual([...availableStatuses(data.entries)].sort(), [
      'added',
      'deleted',
      'modified',
    ]);
  });
});

describe('applyReviewFilter and untracked files', () => {
  // A patch from the `ghdiff` command, where two of the new files are ones git
  // has never been told about. Their change type is 'new' like any other added
  // file, which is the whole reason the status has to be told to this from
  // outside rather than read off the patch.
  const localEntries = [
    entry('src/index.ts', 'modified', 0),
    entry('src/added.ts', 'added', 1),
    { ...entry('src/scratch.ts', 'untracked', 2), changeType: 'new' as const },
    { ...entry('notes.md', 'untracked', 3), changeType: 'new' as const },
  ];
  const localData: ReviewData = {
    entries: localEntries,
    items: localEntries.map((item) => ({
      id: item.itemId,
      type: 'diff' as const,
      fileDiff: { name: item.path, unifiedLineCount: 1 } as never,
      version: 0,
    })),
    stats: { addedLines: 4, deletedLines: 0, fileCount: 4, totalLines: 4 },
  };

  function localPaths(state: ReviewFilterState): string[] {
    return applyReviewFilter(localData, state).entries.map((item) => item.path);
  }

  it('shows them by default', () => {
    assert.deepEqual(localPaths(EMPTY_FILTER_STATE), [
      'src/index.ts',
      'src/added.ts',
      'src/scratch.ts',
      'notes.md',
    ]);
  });

  it('hides them, and only them, when the switch is thrown', () => {
    assert.deepEqual(
      localPaths({ ...EMPTY_FILTER_STATE, hideUntracked: true }),
      ['src/index.ts', 'src/added.ts']
    );
  });

  it('counts them as hidden, so the filter chip says so', () => {
    const result = applyReviewFilter(localData, {
      ...EMPTY_FILTER_STATE,
      hideUntracked: true,
    });
    assert.equal(result.hiddenCount, 2);
  });

  it('keeps them through a status filter that does not name them', () => {
    // The status menu offers the four statuses a patch can describe and never
    // this one, so picking Added must not take the untracked files away with
    // nothing left to bring them back. One switch owns them.
    assert.deepEqual(
      localPaths({ ...EMPTY_FILTER_STATE, statuses: new Set(['added']) }),
      ['src/added.ts', 'src/scratch.ts', 'notes.md']
    );
  });

  it('lets the two controls hide them together', () => {
    assert.deepEqual(
      localPaths({
        ...EMPTY_FILTER_STATE,
        statuses: new Set(['added']),
        hideUntracked: true,
      }),
      ['src/added.ts']
    );
  });

  it('still answers to the preset and the query', () => {
    assert.deepEqual(localPaths({ ...EMPTY_FILTER_STATE, query: 'scratch' }), [
      'src/scratch.ts',
    ]);
    assert.deepEqual(localPaths({ ...EMPTY_FILTER_STATE, presetId: 'docs' }), [
      'notes.md',
    ]);
  });
});

describe('presetStats', () => {
  it('counts the files each preset would keep', () => {
    const stats = presetStats(data.entries, ['all', 'tests', 'without-tests']);
    assert.equal(stats.get('all')?.files, PATHS.length);
    assert.equal(stats.get('tests')?.files, 2);
    assert.equal(stats.get('without-tests')?.files, PATHS.length - 2);
  });

  it('sums the added and deleted lines of the files it keeps', () => {
    const stats = presetStats(data.entries, ['all', 'tests']);
    // Every stub entry carries one added line and no deleted lines.
    assert.equal(stats.get('all')?.addedLines, PATHS.length);
    assert.equal(stats.get('all')?.deletedLines, 0);
    assert.equal(stats.get('tests')?.addedLines, 2);
  });

  it('counts only the files a narrow preset keeps', () => {
    // README.md is the one docs file in the fixture.
    assert.deepEqual(presetStats(data.entries, ['docs']).get('docs'), {
      files: 1,
      addedLines: 1,
      deletedLines: 0,
    });
  });

  it('reports zeroes when there are no files at all', () => {
    assert.deepEqual(presetStats([], ['all', 'tests']).get('tests'), {
      files: 0,
      addedLines: 0,
      deletedLines: 0,
    });
  });
});
