import { createHash } from 'node:crypto';

// Generated on demand: the million-line inputs never enter Git or a bundle.
export const SHAPES = [
  { id: 'typical', files: 50, linesPerSide: 24, width: 72 },
  { id: 'many-files', files: 3000, linesPerSide: 5, width: 72 },
  { id: 'large-patch', files: 100, linesPerSide: 2000, width: 108 },
  { id: 'million-lines', files: 100, linesPerSide: 5000, width: 42 },
  { id: 'huge-file', files: 1, linesPerSide: 400000, width: 54 },
];

export function generateFixture(shape) {
  const parts = [];
  for (let file = 0; file < shape.files; file++) {
    const directory = ['src', 'tests', 'docs', 'generated'][file % 4];
    const path = `${directory}/package-${file % 17}/file-${file}.ts`;
    parts.push(
      `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,${shape.linesPerSide} +1,${shape.linesPerSide} @@\n`
    );
    for (const side of ['-', '+']) {
      for (let line = 0; line < shape.linesPerSide; line++) {
        const tail =
          file === shape.files - 1 &&
          line === shape.linesPerSide - 1 &&
          side === '+';
        const text = tail
          ? '__TAIL_NEEDLE__'
          : `const value = ${side === '-' ? 0 : 1}; // ${line}`;
        parts.push(`${side}${text.padEnd(shape.width, 'x')}\n`);
      }
    }
  }
  return parts.join('');
}

export function fixtureRecord(shape, patch = generateFixture(shape)) {
  return {
    ...shape,
    bytes: Buffer.byteLength(patch),
    sha256: createHash('sha256').update(patch).digest('hex'),
    addedLines: shape.files * shape.linesPerSide,
    deletedLines: shape.files * shape.linesPerSide,
    totalLines: shape.files * shape.linesPerSide * 2,
    tailMatches: 1,
  };
}
