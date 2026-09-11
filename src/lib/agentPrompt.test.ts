import type { FileDiffMetadata } from '@pierre/diffs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAgentPrompt, MAX_QUOTED_LINES } from './agentPrompt.ts';
import { commentSection, commentThread } from './commentFixtures.ts';
import type { CommentListSection } from './comments.ts';

// One file of ten new lines, as one hunk of one change block. That is enough
// for every question here: which line a note quotes, how a range is labelled,
// and what happens when the diff cannot answer.
function fileDiff(name: string, lines: readonly string[]): FileDiffMetadata {
  return {
    name,
    additionLines: [...lines],
    deletionLines: [],
    hunks: [
      {
        additionStart: 1,
        additionCount: lines.length,
        additionLineIndex: 0,
        deletionStart: 1,
        deletionCount: 0,
        deletionLineIndex: 0,
        hunkContent: [
          {
            type: 'change',
            additions: lines.length,
            additionLineIndex: 0,
            deletions: 0,
            deletionLineIndex: 0,
          },
        ],
      },
    ],
  } as unknown as FileDiffMetadata;
}

const CODE = [
  'const a = 1;',
  'const b = 2;',
  'const c = 3;',
  'const d = 4;',
  'const e = 5;',
];

function build(
  sections: readonly CommentListSection[],
  options: { named?: boolean; lines?: readonly string[] } = {}
): string | undefined {
  const lines = options.lines ?? CODE;
  return buildAgentPrompt({
    sections,
    fileDiffById: new Map(
      sections.map((item) => [item.itemId, fileDiff(item.path, lines)])
    ),
    targetLabel: 'ghdiff · working tree',
    named: options.named ?? false,
  });
}

describe('buildAgentPrompt', () => {
  it('writes the note under the line it is about', () => {
    const text = build([
      commentSection('src/a.ts', [
        commentThread({ body: 'Handle the null case.' }),
      ]),
    ]);
    assert.equal(
      text,
      [
        'Review notes from ghdiff — ghdiff · working tree',
        '',
        '## src/a.ts',
        '',
        '### line 2',
        '',
        '```ts',
        'const b = 2;',
        '```',
        '',
        'Handle the null case.',
        '',
      ].join('\n')
    );
  });

  it('answers with nothing when there is nothing to say', () => {
    // Not a header with no notes under it: a press by accident on an empty
    // review should leave the clipboard alone.
    assert.equal(build([]), undefined);
    assert.equal(build([commentSection('src/a.ts', [])]), undefined);
  });

  it('keeps the files in diff order and groups each one once', () => {
    const text =
      build([
        commentSection('src/a.ts', [
          commentThread({ body: 'first' }),
          commentThread({ key: 'k2', body: 'second', lineNumber: 4 }),
        ]),
        commentSection(
          'src/b.ts',
          [commentThread({ itemId: 'src/b.ts', body: 'third' })],
          1
        ),
      ]) ?? '';
    assert.deepEqual(text.match(/^## .*$/gm), ['## src/a.ts', '## src/b.ts']);
    assert.ok(text.indexOf('first') < text.indexOf('second'));
    assert.ok(text.indexOf('second') < text.indexOf('third'));
  });

  it('labels a range with both its ends', () => {
    const text =
      build([
        commentSection('src/a.ts', [
          commentThread({
            body: 'Extract this.',
            lineNumber: 4,
            range: {
              start: 2,
              end: 4,
              side: 'additions',
              endSide: 'additions',
            },
          }),
        ]),
      ]) ?? '';
    assert.ok(text.includes('### lines 2-4'), text);
    assert.ok(text.includes('const b = 2;\nconst c = 3;\nconst d = 4;'), text);
  });

  it('falls back to the anchored line when a range crosses the two sides', () => {
    // There is no one side to quote, and the anchor is the line GitHub would
    // file the comment against.
    const text =
      build([
        commentSection('src/a.ts', [
          commentThread({
            body: 'Why both?',
            lineNumber: 3,
            range: {
              start: 1,
              end: 3,
              side: 'deletions',
              endSide: 'additions',
            },
          }),
        ]),
      ]) ?? '';
    assert.ok(text.includes('### line 3'), text);
    assert.ok(text.includes('const c = 3;'), text);
  });

  it('caps a long quotation and says how much it cut', () => {
    const many = Array.from(
      { length: 60 },
      (_unused, index) => `line ${index + 1}`
    );
    const text =
      build(
        [
          commentSection('src/a.ts', [
            commentThread({
              body: 'All of this.',
              lineNumber: 50,
              range: {
                start: 1,
                end: 50,
                side: 'additions',
                endSide: 'additions',
              },
            }),
          ]),
        ],
        { lines: many }
      ) ?? '';
    // The label names what the reviewer selected, and the quotation says what
    // it left out, so the two cannot disagree about the range.
    assert.ok(text.includes('### lines 1-50'), text);
    assert.ok(text.includes(`line ${MAX_QUOTED_LINES}`), text);
    assert.ok(!text.includes(`line ${MAX_QUOTED_LINES + 1}\n`), text);
    assert.ok(text.includes(`… ${50 - MAX_QUOTED_LINES} more lines`), text);
  });

  it('says "line" rather than "lines" when it cut exactly one', () => {
    const many = Array.from(
      { length: 40 },
      (_unused, index) => `line ${index + 1}`
    );
    const text =
      build(
        [
          commentSection('src/a.ts', [
            commentThread({
              body: 'note',
              lineNumber: MAX_QUOTED_LINES + 1,
              range: {
                start: 1,
                end: MAX_QUOTED_LINES + 1,
                side: 'additions',
                endSide: 'additions',
              },
            }),
          ]),
        ],
        { lines: many }
      ) ?? '';
    assert.ok(text.includes('… 1 more line\n'), text);
  });

  it('writes the note with no quotation when the diff has no such line', () => {
    // An expanded line the patch does not carry, or a file whose metadata the
    // filter has taken away. The note is still the point.
    const text =
      build([
        commentSection('src/a.ts', [
          commentThread({
            body: 'still here',
            lineNumber: 99,
            range: {
              start: 99,
              end: 99,
              side: 'additions',
              endSide: 'additions',
            },
          }),
        ]),
      ]) ?? '';
    assert.ok(text.includes('still here'), text);
    assert.ok(!text.includes('```'), text);
  });

  it('names the authors on a GitHub thread and nobody on a local one', () => {
    const conversation = commentThread({
      body: 'Is this needed?',
      messages: [
        { key: 'm1', author: 'alice', body: 'Is this needed?' },
        { key: 'm2', author: 'bob', body: 'Yes, for the retry.' },
      ],
      replyCount: 1,
    });
    const named =
      build([commentSection('src/a.ts', [conversation])], { named: true }) ??
      '';
    assert.ok(named.includes('**alice:** Is this needed?'), named);
    assert.ok(named.includes('**bob:** Yes, for the retry.'), named);

    const unnamed = build([commentSection('src/a.ts', [conversation])]) ?? '';
    assert.ok(!unnamed.includes('**'), unnamed);
    assert.ok(unnamed.includes('Is this needed?'), unnamed);
    assert.ok(unnamed.includes('Yes, for the retry.'), unnamed);
  });

  it('tags the fence from the path, and leaves it bare when it cannot', () => {
    const tagged =
      build([commentSection('src/a.ts', [commentThread({ body: 'x' })])]) ?? '';
    assert.ok(tagged.includes('```ts\n'), tagged);

    const bare =
      build([
        commentSection('Dockerfile', [
          commentThread({ itemId: 'Dockerfile', body: 'x' }),
        ]),
      ]) ?? '';
    assert.ok(bare.includes('```\n'), bare);
    // A dotfile is its own name and not an extension of something.
    const dotfile =
      build([
        commentSection('.gitignore', [
          commentThread({ itemId: '.gitignore', body: 'x' }),
        ]),
      ]) ?? '';
    assert.ok(dotfile.includes('```\n'), dotfile);
  });

  it('trims the note but keeps what is inside it', () => {
    const text =
      build([
        commentSection('src/a.ts', [
          commentThread({ body: '  first\n\nsecond  ' }),
        ]),
      ]) ?? '';
    assert.ok(text.includes('\nfirst\n\nsecond\n'), text);
  });
});
