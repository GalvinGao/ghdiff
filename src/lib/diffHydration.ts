import { type FileDiffMetadata, SPLIT_WITH_NEWLINES } from '@pierre/diffs';

// Turning a patch back into the two whole files it was cut from.
//
// A patch carries the changed lines and three lines of context either side, and
// nothing else. `@pierre/diffs` shows the rest of a file — the unmodified lines
// a reviewer expands into — only once it has been handed both sides in full, so
// something has to fetch them.
//
// The new side is one request: the file at the commit the diff ends on. The old
// side is then arithmetic rather than a second request, because a patch already
// says everything that separates the two. Outside a hunk the two sides are the
// same lines by definition, and inside one the patch holds the old lines
// itself. So the old file is the new file with each hunk's new-side lines
// swapped for the patch's own old-side lines — a reverse-apply, which is exact.
//
// Exact, and only as exact as the file that arrives. A branch that moved
// between the patch and the fetch gives a new side the patch does not describe,
// and reverse-applying that would print lines nobody wrote: `patchFitsNewFile`
// is what refuses instead. It has to be asked before the rebuild, every time,
// because `hydratePartialDiff` re-reads the hunks' own lines out of the two
// arrays as well — a wrong file corrupts the changes on screen, not just the
// context around them.

/**
 * Splits file text into lines, each keeping its own line break. The library
 * splits the loaded contents by the same rule, so the indexes this module
 * computes are the indexes it will read.
 */
export function splitFileLines(contents: string): string[] {
  return contents === '' ? [] : contents.split(SPLIT_WITH_NEWLINES);
}

/**
 * Zero-based index of the first line a hunk covers on one side, from the `-a,b`
 * or `+a,b` of its header. An empty range counts from `a` rather than `a - 1`:
 * git writes `+a,0` for a block deleted after line `a`, so the hunk covers no
 * new line and starts where the next one does.
 */
function sideStart(start: number, count: number): number {
  return start - (count === 0 ? 0 : 1);
}

/** Compares two lines for equal text, whatever line break each one ends on. */
function sameLine(a: string, b: string): boolean {
  return a.replace(/\r?\n$/, '') === b.replace(/\r?\n$/, '');
}

/**
 * True when every new-side line the patch names is the line the fetched file
 * has in that place. False means the file has moved on since the diff was made,
 * and neither side can be trusted.
 */
export function patchFitsNewFile(
  fileDiff: FileDiffMetadata,
  newLines: readonly string[]
): boolean {
  for (const hunk of fileDiff.hunks) {
    const start = sideStart(hunk.additionStart, hunk.additionCount);
    if (start < 0 || start + hunk.additionCount > newLines.length) return false;
    for (let offset = 0; offset < hunk.additionCount; offset++) {
      const fromPatch = fileDiff.additionLines[hunk.additionLineIndex + offset];
      const fromFile = newLines[start + offset];
      if (fromPatch == null || fromFile == null) return false;
      if (!sameLine(fromPatch, fromFile)) return false;
    }
  }
  return true;
}

/**
 * The old file, rebuilt from the new file and the patch. Ask `patchFitsNewFile`
 * first: this function trusts what it is given and reads straight through.
 */
export function oldFileFromPatch(
  fileDiff: FileDiffMetadata,
  newLines: readonly string[]
): string {
  const lines: string[] = [];
  let cursor = 0;
  for (const hunk of fileDiff.hunks) {
    const start = sideStart(hunk.additionStart, hunk.additionCount);
    // Between the last hunk and this one nothing changed, so the new file's own
    // lines are the old file's lines.
    for (let index = cursor; index < start; index++) {
      lines.push(newLines[index] ?? '');
    }
    // Inside the hunk the patch is the authority on the old side, context lines
    // included: `deletionCount` counts both.
    for (let offset = 0; offset < hunk.deletionCount; offset++) {
      lines.push(fileDiff.deletionLines[hunk.deletionLineIndex + offset] ?? '');
    }
    cursor = start + hunk.additionCount;
  }
  for (let index = cursor; index < newLines.length; index++) {
    lines.push(newLines[index] ?? '');
  }
  return lines.join('');
}
