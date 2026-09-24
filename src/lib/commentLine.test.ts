import type { FileDiffMetadata } from '@pierre/diffs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyCommentLineType, commentLineText } from './commentLine.ts';

// A file where two lines were replaced by three, with context either side:
//
//   1  const a = 1;      context
//   2  const b = 2;      context
//   3  const B = 2;      + (was `const b = old;` and `const c = old;`)
//   4  const C = 3;      +
//   5  const D = 4;      +
//   6  const e = 5;      context
//
// Both sides of the same hunk, so a lookup has to choose the right array and
// the right offset into it rather than assume the two run together.
const DIFF = {
  name: 'src/a.ts',
  additionLines: [
    'const a = 1;',
    'const b = 2;',
    'const B = 2;',
    'const C = 3;',
    'const D = 4;',
    'const e = 5;',
  ],
  deletionLines: [
    'const a = 1;',
    'const b = 2;',
    'const b = old;',
    'const c = old;',
    'const e = 5;',
  ],
  hunks: [
    {
      additionStart: 1,
      additionCount: 6,
      additionLineIndex: 0,
      deletionStart: 1,
      deletionCount: 5,
      deletionLineIndex: 0,
      hunkContent: [
        {
          type: 'context',
          lines: 2,
          additionLineIndex: 0,
          deletionLineIndex: 0,
        },
        {
          type: 'change',
          additions: 3,
          additionLineIndex: 2,
          deletions: 2,
          deletionLineIndex: 2,
        },
        {
          type: 'context',
          lines: 1,
          additionLineIndex: 5,
          deletionLineIndex: 4,
        },
      ],
    },
  ],
} as unknown as FileDiffMetadata;

describe('commentLineText', () => {
  it('reads a context line on either side', () => {
    assert.equal(commentLineText(DIFF, 'additions', 1), 'const a = 1;');
    assert.equal(commentLineText(DIFF, 'deletions', 1), 'const a = 1;');
  });

  it('reads an added line by its number on the new side', () => {
    assert.equal(commentLineText(DIFF, 'additions', 3), 'const B = 2;');
    assert.equal(commentLineText(DIFF, 'additions', 5), 'const D = 4;');
  });

  it('reads a deleted line by its number on the old side', () => {
    // The two sides number the same change block differently, which is the
    // whole reason the side has to be asked for rather than inferred.
    assert.equal(commentLineText(DIFF, 'deletions', 3), 'const b = old;');
    assert.equal(commentLineText(DIFF, 'deletions', 4), 'const c = old;');
  });

  it('reads the context after a change block, past the offset it moved', () => {
    // Line 6 on the new side and line 5 on the old are the same text, and each
    // sits at a different index in its own array.
    assert.equal(commentLineText(DIFF, 'additions', 6), 'const e = 5;');
    assert.equal(commentLineText(DIFF, 'deletions', 5), 'const e = 5;');
  });

  it('answers with nothing for a line the diff does not carry', () => {
    assert.equal(commentLineText(DIFF, 'additions', 0), undefined);
    assert.equal(commentLineText(DIFF, 'additions', 7), undefined);
    assert.equal(commentLineText(DIFF, 'deletions', 6), undefined);
  });

  it('leaves the line ending behind', () => {
    // The arrays hold each line as the patch carried it. A caller quoting
    // several back to back would otherwise get a blank line between each pair,
    // which is what a real patch did before this.
    const terminated = {
      ...DIFF,
      additionLines: ['first\n', 'second\r\n', 'third'],
    } as unknown as FileDiffMetadata;
    assert.equal(commentLineText(terminated, 'additions', 1), 'first');
    assert.equal(commentLineText(terminated, 'additions', 2), 'second');
    assert.equal(commentLineText(terminated, 'additions', 3), 'third');
  });

  it('agrees with the classifier about which lines changed', () => {
    // The two walk the same blocks, so a line one calls a change is a line the
    // other reads out of the change block.
    assert.equal(classifyCommentLineType(DIFF, 'additions', 3), 'change');
    assert.equal(classifyCommentLineType(DIFF, 'additions', 1), 'context');
    assert.equal(classifyCommentLineType(DIFF, 'additions', 6), 'context');
  });
});
