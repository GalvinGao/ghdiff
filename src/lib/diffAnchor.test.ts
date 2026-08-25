import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildDiffAnchorIndex,
  buildGitHubDigestIndex,
  formatDiffAnchor,
  formatLineRange,
  lookupDiffAnchor,
  parseLineRange,
} from './diffAnchor.ts';
import type { ReviewFileEntry } from './reviewData.ts';

function entry(path: string, itemId = path): ReviewFileEntry {
  return {
    itemId,
    path,
    treePath: itemId,
    fileOrder: 0,
    changeType: 'change',
    status: 'modified',
    addedLines: 0,
    deletedLines: 0,
  };
}

const INDEX = buildDiffAnchorIndex([
  entry('src/lib/reviewFilter.ts'),
  entry('README.md'),
  entry('src/odd:R42'),
  entry('src/oddR42.ts'),
]);

describe('formatDiffAnchor', () => {
  it('names a file on its own', () => {
    assert.equal(
      formatDiffAnchor('src/lib/reviewFilter.ts'),
      'diff-src/lib/reviewFilter.ts'
    );
  });

  it('writes a single line as one point', () => {
    assert.equal(
      formatDiffAnchor('README.md', { start: 42, end: 42, side: 'additions' }),
      'diff-README.md:R42'
    );
    assert.equal(
      formatDiffAnchor('README.md', { start: 42, end: 42, side: 'deletions' }),
      'diff-README.md:L42'
    );
  });

  it('writes a range as two points', () => {
    assert.equal(
      formatLineRange({ start: 42, end: 58, side: 'additions' }),
      'R42-R58'
    );
    assert.equal(
      formatLineRange({
        start: 18,
        end: 24,
        side: 'deletions',
        endSide: 'additions',
      }),
      'L18-R24'
    );
  });

  it('keeps the two ends of a range dragged upwards in that order', () => {
    assert.equal(
      formatLineRange({ start: 58, end: 42, side: 'additions' }),
      'R58-R42'
    );
  });

  it('reads the new file when the selection names no side', () => {
    assert.equal(formatLineRange({ start: 7, end: 7 }), 'R7');
  });
});

describe('parseLineRange', () => {
  it('reads one point as a range of one line', () => {
    assert.deepEqual(parseLineRange('R42'), {
      start: 42,
      end: 42,
      side: 'additions',
    });
  });

  it('leaves endSide off a range that stays on one side', () => {
    assert.deepEqual(parseLineRange('L5-L9'), {
      start: 5,
      end: 9,
      side: 'deletions',
    });
  });

  it('sets endSide on a range across the two sides', () => {
    assert.deepEqual(parseLineRange('L18-R24'), {
      start: 18,
      end: 24,
      side: 'deletions',
      endSide: 'additions',
    });
  });

  it('refuses what is not a line part', () => {
    assert.equal(parseLineRange(''), null);
    assert.equal(parseLineRange('R'), null);
    assert.equal(parseLineRange('42'), null);
    assert.equal(parseLineRange('R0'), null);
    assert.equal(parseLineRange('r42'), null);
    assert.equal(parseLineRange('R42-'), null);
    assert.equal(parseLineRange('R42-R58-R60'), null);
    assert.equal(parseLineRange('R42.ts'), null);
  });

  it('round-trips every range it writes', () => {
    for (const range of [
      { start: 1, end: 1, side: 'additions' },
      { start: 3, end: 9, side: 'deletions' },
      { start: 58, end: 42, side: 'additions' },
      { start: 18, end: 24, side: 'deletions', endSide: 'additions' },
    ] as const) {
      assert.deepEqual(parseLineRange(formatLineRange(range)), range);
    }
  });
});

describe('lookupDiffAnchor', () => {
  it('places a file anchor, with or without the hash character', () => {
    assert.deepEqual(lookupDiffAnchor(INDEX, 'diff-README.md'), {
      kind: 'item',
      itemId: 'README.md',
    });
    assert.deepEqual(lookupDiffAnchor(INDEX, '#diff-README.md'), {
      kind: 'item',
      itemId: 'README.md',
    });
  });

  it('places a line anchor', () => {
    assert.deepEqual(
      lookupDiffAnchor(INDEX, '#diff-src/lib/reviewFilter.ts:R42-R58'),
      {
        kind: 'item',
        itemId: 'src/lib/reviewFilter.ts',
        range: { start: 42, end: 58, side: 'additions' },
      }
    );
  });

  it('ignores a fragment that is not a diff anchor', () => {
    assert.equal(lookupDiffAnchor(INDEX, ''), null);
    assert.equal(lookupDiffAnchor(INDEX, '#top'), null);
    assert.equal(lookupDiffAnchor(INDEX, '#diff-'), null);
  });

  it('ignores a file this diff does not hold', () => {
    assert.equal(lookupDiffAnchor(INDEX, '#diff-src/gone.ts'), null);
    assert.equal(lookupDiffAnchor(INDEX, '#diff-src/gone.ts:R3'), null);
  });

  it('reads a path that ends in what looks like a line part', () => {
    assert.deepEqual(lookupDiffAnchor(INDEX, '#diff-src/oddR42.ts'), {
      kind: 'item',
      itemId: 'src/oddR42.ts',
    });
  });

  it('prefers the file that holds the colon over the split', () => {
    assert.deepEqual(lookupDiffAnchor(INDEX, '#diff-src/odd:R42'), {
      kind: 'item',
      itemId: 'src/odd:R42',
    });
  });

  it('splits when the path before the colon is the file', () => {
    const index = buildDiffAnchorIndex([
      entry('src/odd'),
      entry('src/odd:R42'),
    ]);
    assert.deepEqual(lookupDiffAnchor(index, '#diff-src/odd:R42'), {
      kind: 'item',
      itemId: 'src/odd',
      range: { start: 42, end: 42, side: 'additions' },
    });
  });

  it("finds a series' copy of a file from the plain path", () => {
    const index = buildDiffAnchorIndex([
      entry('src/app.ts', 'abc1234/src/app.ts'),
      entry('src/app.ts', 'def5678/src/app.ts'),
    ]);
    assert.deepEqual(lookupDiffAnchor(index, '#diff-abc1234/src/app.ts:R9'), {
      kind: 'item',
      itemId: 'abc1234/src/app.ts',
      range: { start: 9, end: 9, side: 'additions' },
    });
    // No commit named, so the first commit that touched the file answers.
    assert.deepEqual(lookupDiffAnchor(index, '#diff-src/app.ts'), {
      kind: 'item',
      itemId: 'abc1234/src/app.ts',
    });
  });

  it("reads github.com's own anchor", () => {
    const digest = 'a'.repeat(64);
    assert.deepEqual(lookupDiffAnchor(INDEX, `#diff-${digest}`), {
      kind: 'digest',
      digest,
    });
    assert.deepEqual(lookupDiffAnchor(INDEX, `#diff-${digest}R42-R58`), {
      kind: 'digest',
      digest,
      range: { start: 42, end: 58, side: 'additions' },
    });
    assert.deepEqual(lookupDiffAnchor(INDEX, `#diff-${digest}L10-R20`), {
      kind: 'digest',
      digest,
      range: { start: 10, end: 20, side: 'deletions', endSide: 'additions' },
    });
  });

  it('reads a file named in 64 hex digits as the file it is', () => {
    const name = 'b'.repeat(64);
    const index = buildDiffAnchorIndex([entry(name)]);
    assert.deepEqual(lookupDiffAnchor(index, `#diff-${name}`), {
      kind: 'item',
      itemId: name,
    });
  });
});

describe('buildGitHubDigestIndex', () => {
  it('keys each file by the SHA-256 of its path', async () => {
    // The digest github.com writes for `README.md`. Take it from any pull
    // request that changes that file: the anchor reads `#diff-<this>`.
    const readme =
      'b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5';
    const digests = await buildGitHubDigestIndex([
      entry('README.md'),
      entry('src/lib/reviewFilter.ts'),
    ]);
    assert.equal(digests.size, 2);
    assert.equal(digests.get(readme), 'README.md');
  });

  it('answers an anchor github.com would have written', async () => {
    const entries = [entry('README.md'), entry('src/lib/reviewFilter.ts')];
    const digests = await buildGitHubDigestIndex(entries);
    const [digest] = [...digests].find(
      ([, itemId]) => itemId === 'src/lib/reviewFilter.ts'
    ) ?? ['', ''];

    const lookup = lookupDiffAnchor(
      buildDiffAnchorIndex(entries),
      `#diff-${digest}R7`
    );
    assert.deepEqual(lookup, {
      kind: 'digest',
      digest,
      range: { start: 7, end: 7, side: 'additions' },
    });
    assert.equal(digests.get(digest), 'src/lib/reviewFilter.ts');
  });
});
