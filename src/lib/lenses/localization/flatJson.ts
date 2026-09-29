import type { FileDiffMetadata } from '@pierre/diffs';

// A catalogue that holds one message per line, read from the patch alone.
//
// `"key": "value",` is the whole grammar, and it is enough for most message
// files a build writes: one object, a string per key, sorted or not. Reading it
// line by line needs no request for the file, so a diff of eighteen locales is
// a table the moment the patch is parsed.
//
// The limit is the whole point of the reader, and it is stated as a refusal.
// A changed line that is not an entry — a nested object, a plural variant, an
// array — answers `undefined` for the whole file, and a file the reader refuses
// stays in the diff as it was. Leaving a file raw costs the reviewer the table;
// guessing at it would cost them a change they never saw.

export type CatalogueSource = Pick<
  FileDiffMetadata,
  'hunks' | 'additionLines' | 'deletionLines'
>;

/** One key's two sides in one file. */
export interface CatalogueChange {
  key: string;
  old?: string;
  new?: string;
  /** Old-side line number, when the key was deleted or changed. */
  oldLine?: number;
  /** New-side line number, when the key was added or changed. */
  newLine?: number;
}

interface EntryLine {
  key: string;
  value: string;
  indent: number;
}

const ENTRY = /^(\s*)("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*")\s*,?\s*$/;
const STRUCTURAL = /^\s*[{}]\s*,?\s*$/;

/** One `"key": "value"` line, or nothing for any other line. */
export function readEntryLine(line: string): EntryLine | undefined {
  const match = ENTRY.exec(line.replace(/\r?\n$/, ''));
  if (match == null) return undefined;
  try {
    const key: unknown = JSON.parse(match[2] ?? '');
    const value: unknown = JSON.parse(match[3] ?? '');
    if (typeof key !== 'string' || typeof value !== 'string') return undefined;
    return { key, value, indent: (match[1] ?? '').length };
  } catch {
    return undefined;
  }
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/**
 * Every key a file's patch changes, or `undefined` when a changed line is not
 * a top-level entry.
 *
 * Top level is read from indentation, which is the one structural fact a hunk
 * carries: every entry line the patch shows, context included, votes for the
 * shallowest indent, and a changed entry deeper than that sits inside something
 * this reader does not model. A pair of lines whose value did not change — the
 * comma a new last entry adds to the one above it — is no change at all.
 */
export function readFlatCatalogue(
  fileDiff: CatalogueSource
): CatalogueChange[] | undefined {
  const deleted = new Map<string, { value: string; line: number }>();
  const added = new Map<string, { value: string; line: number }>();
  const changedIndents: number[] = [];
  let shallowest = Number.POSITIVE_INFINITY;

  for (const hunk of fileDiff.hunks) {
    let oldLine = hunk.deletionStart;
    let newLine = hunk.additionStart;
    for (const block of hunk.hunkContent) {
      if (block.type === 'context') {
        for (let offset = 0; offset < block.lines; offset++) {
          const text = fileDiff.additionLines[block.additionLineIndex + offset];
          const entry = text == null ? undefined : readEntryLine(text);
          if (entry != null) shallowest = Math.min(shallowest, entry.indent);
        }
        oldLine += block.lines;
        newLine += block.lines;
        continue;
      }
      const sides = [
        {
          count: block.deletions,
          start: block.deletionLineIndex,
          lines: fileDiff.deletionLines,
          into: deleted,
          first: oldLine,
        },
        {
          count: block.additions,
          start: block.additionLineIndex,
          lines: fileDiff.additionLines,
          into: added,
          first: newLine,
        },
      ];
      for (const side of sides) {
        for (let offset = 0; offset < side.count; offset++) {
          const text = side.lines[side.start + offset] ?? '';
          if (isBlank(text) || STRUCTURAL.test(text)) continue;
          const entry = readEntryLine(text);
          if (entry == null) return undefined;
          // A key twice on one side is a file this reader cannot pair.
          if (side.into.has(entry.key)) return undefined;
          side.into.set(entry.key, {
            value: entry.value,
            line: side.first + offset,
          });
          changedIndents.push(entry.indent);
          shallowest = Math.min(shallowest, entry.indent);
        }
      }
      oldLine += block.deletions;
      newLine += block.additions;
    }
  }

  if (changedIndents.some((indent) => indent !== shallowest)) return undefined;

  const changes: CatalogueChange[] = [];
  for (const [key, before] of deleted) {
    const after = added.get(key);
    if (after?.value === before.value) continue;
    changes.push({
      key,
      old: before.value,
      oldLine: before.line,
      ...(after == null ? {} : { new: after.value, newLine: after.line }),
    });
  }
  for (const [key, after] of added) {
    if (deleted.has(key)) continue;
    changes.push({ key, new: after.value, newLine: after.line });
  }
  return changes;
}
