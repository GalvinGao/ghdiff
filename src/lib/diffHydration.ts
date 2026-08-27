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
 * The largest file ghdiff will read for its unmodified lines. Around this size
 * a source file runs to the hundred thousand lines at which the viewer gives up
 * highlighting it, so little above the line improves what is on screen.
 *
 * Both ends hold it, and they have to. The route knows only what GitHub's
 * headers say, and `content-length` states the **compressed** size whenever
 * GitHub compressed the answer — 4.8 MB of word list arrives declaring 1.4 MB —
 * and some answers carry no length at all. So the route rejects what it can
 * prove is too big, and the browser counts the bytes it actually decodes, which
 * is where the file becomes a string and where the string is the cost.
 */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** What both ends say when a file runs past it. */
export const FILE_TOO_LARGE =
  'That file is too large to show its unmodified lines.';

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

/**
 * The body, as text, and nothing past `MAX_FILE_BYTES` of it.
 *
 * The route turns an oversized file away on the length GitHub declared, but
 * that length is the compressed one whenever GitHub compressed the answer and
 * is absent from some answers altogether. So the decoded bytes are counted
 * here, on the way in: this is the point where a file becomes a string in the
 * reviewer's tab, which is the cost the limit is about.
 */
export async function readCappedText(response: Response): Promise<string> {
  const body = response.body;
  // No stream to read means no way to count, and only a runtime with no
  // streaming fetch at all lands here.
  if (body == null) return await response.text();

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let read = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      if (read > MAX_FILE_BYTES) throw new Error(FILE_TOO_LARGE);
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    // Releases the lock on the way out, and cancels the rest of the download
    // when this is the throw above rather than the end of the file.
    await reader.cancel().catch(() => undefined);
  }
  return text + decoder.decode();
}
