import type { SelectedLineRange, SelectionSide } from '@pierre/diffs';

import type { ReviewFileEntry } from './reviewData.ts';

// The fragment that names a place in a diff.
//
// github.com writes one of these on every file row and every line number of a
// pull request, and reviewer answers the same grammar: a file part, then an
// optional line part of one or two points, each point a side letter and a line
// number. `R` is the right column, which is the new file; `L` is the left
// column, which is the old one.
//
//   #diff-src/lib/reviewFilter.ts           the file, scrolled to its own top
//   #diff-src/lib/reviewFilter.ts:R42       one line of the new file
//   #diff-src/lib/reviewFilter.ts:L42       one line of the old file
//   #diff-src/lib/reviewFilter.ts:R42-R58   a range down the new file
//   #diff-src/lib/reviewFilter.ts:L18-R24   a range across the two sides
//   #diff-abc1234/src/lib/reviewFilter.ts   one commit's copy of a file
//   #diff-<64 hex digits>R42-R58            github.com's own form, read only
//
// The one difference is the file part. GitHub writes the SHA-256 of the path,
// which tells a reader nothing and cannot be typed; reviewer writes the item
// id, which is the path itself, and puts a `:` in front of the line part. A
// fragment may hold a `/` and a `:` unescaped, so the address bar shows the
// path as it is written on disk.
//
// A path can itself end in something that reads as a line part, and a path can
// hold a `:`. So the split is never decided by the text alone: `lookupDiffAnchor`
// tries each reading against the files of the diff on screen and keeps the one
// that names a file. The digest reading is tried last, which is what keeps a
// file genuinely named by 64 hex digits from being read as a GitHub link.
//
// The line part is written exactly as the viewer reports the selection, which
// means a range dragged upwards keeps its two ends in that order. Re-reading it
// reproduces the selection the reviewer made, rather than a mirrored one.

const PREFIX = 'diff-';
const SEPARATOR = ':';

/** One point, or two joined by `-`. Nine digits is more lines than any file. */
const LINE_RANGE = /^([LR])(\d{1,9})(?:-([LR])(\d{1,9}))?$/;

/** github.com's form: the digest, then the line part with no separator. */
const GITHUB_ANCHOR = /^([0-9a-f]{64})((?:[LR]\d{1,9}(?:-[LR]\d{1,9})?)?)$/;

export type DiffAnchorLookup =
  | { kind: 'item'; itemId: string; range?: SelectedLineRange }
  | { kind: 'digest'; digest: string; range?: SelectedLineRange };

/** Every name the files of one diff answer to. */
export interface DiffAnchorIndex {
  itemIds: ReadonlySet<string>;
  /**
   * The repository-relative path, which is the item id of a single-commit
   * patch and the tail of it in a series. It lets an anchor written against one
   * shape of the same review still find the file.
   */
  itemIdByPath: ReadonlyMap<string, string>;
}

function sideLetter(side: SelectionSide): string {
  return side === 'deletions' ? 'L' : 'R';
}

function sideFromLetter(letter: string): SelectionSide {
  return letter === 'L' ? 'deletions' : 'additions';
}

/**
 * The line part of an anchor. A single line is one point rather than the same
 * point twice, the way GitHub writes it.
 */
export function formatLineRange(range: SelectedLineRange): string {
  const side = range.side ?? 'additions';
  const endSide = range.endSide ?? side;
  const start = `${sideLetter(side)}${String(range.start)}`;
  const end = `${sideLetter(endSide)}${String(range.end)}`;
  return start === end ? start : `${start}-${end}`;
}

/**
 * Reads a line part back into the shape the viewer selects with. `endSide` is
 * set only when the two ends sit on different sides, because that is how
 * @pierre/diffs builds a range and how it compares two of them.
 */
export function parseLineRange(text: string): SelectedLineRange | null {
  const match = LINE_RANGE.exec(text);
  if (match == null) return null;
  const side = sideFromLetter(match[1]);
  const start = Number(match[2]);
  if (start < 1) return null;
  if (match[3] == null) return { start, end: start, side };
  const endSide = sideFromLetter(match[3]);
  const end = Number(match[4]);
  if (end < 1) return null;
  return endSide === side
    ? { start, end, side }
    : { start, end, side, endSide };
}

/** The fragment for a file, and for the lines in it when there are any. */
export function formatDiffAnchor(
  itemId: string,
  range?: SelectedLineRange | null
): string {
  const file = `${PREFIX}${itemId}`;
  if (range == null) return file;
  return `${file}${SEPARATOR}${formatLineRange(range)}`;
}

export function buildDiffAnchorIndex(
  entries: readonly ReviewFileEntry[]
): DiffAnchorIndex {
  const itemIds = new Set<string>();
  const itemIdByPath = new Map<string, string>();
  for (const entry of entries) {
    itemIds.add(entry.itemId);
    // The first commit that touched the file wins. A patch of several commits
    // repeats a path once per commit, and an anchor that names no commit means
    // the file rather than one revision of it.
    if (!itemIdByPath.has(entry.path)) {
      itemIdByPath.set(entry.path, entry.itemId);
    }
  }
  return { itemIds, itemIdByPath };
}

function resolvePath(index: DiffAnchorIndex, path: string): string | undefined {
  if (path.length === 0) return undefined;
  if (index.itemIds.has(path)) return path;
  return index.itemIdByPath.get(path);
}

/**
 * Turns a fragment into the file and lines it names, or into the digest a
 * github.com link carries. Returns null for a fragment this app did not write
 * and cannot place, which the caller leaves alone.
 *
 * The readings are tried in order of how exactly each one names a file: the
 * split at the last `:`, then the whole text as a path, then the digest.
 */
export function lookupDiffAnchor(
  index: DiffAnchorIndex,
  hash: string
): DiffAnchorLookup | null {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!text.startsWith(PREFIX)) return null;
  const body = text.slice(PREFIX.length);

  const cut = body.lastIndexOf(SEPARATOR);
  if (cut > 0) {
    const range = parseLineRange(body.slice(cut + 1));
    if (range != null) {
      const itemId = resolvePath(index, body.slice(0, cut));
      if (itemId != null) return { kind: 'item', itemId, range };
    }
  }

  const whole = resolvePath(index, body);
  if (whole != null) return { kind: 'item', itemId: whole };

  // No file here answers to that path, so read it the way github.com writes
  // one: the SHA-256 of the path, with the line part run straight onto it.
  const github = GITHUB_ANCHOR.exec(body);
  if (github == null) return null;
  const spec = github[2];
  if (spec.length === 0) return { kind: 'digest', digest: github[1] };
  const range = parseLineRange(spec);
  if (range == null) return null;
  return { kind: 'digest', digest: github[1], range };
}

function toHex(buffer: ArrayBuffer): string {
  let hex = '';
  for (const byte of new Uint8Array(buffer)) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Every file of the diff, keyed by the SHA-256 of its path, which is the name
 * github.com gives a file in a fragment. Building it costs one digest per file,
 * so a caller builds it only after a fragment that reads as one of those
 * arrives, and keeps the result for the life of the patch.
 *
 * A browser exposes `crypto.subtle` on a secure origin only. Somewhere it is
 * absent the map comes back empty, and a github.com anchor simply does not
 * resolve; every anchor reviewer writes itself still does.
 */
export async function buildGitHubDigestIndex(
  entries: readonly ReviewFileEntry[]
): Promise<Map<string, string>> {
  const digests = new Map<string, string>();
  const subtle = globalThis.crypto?.subtle;
  if (subtle == null) return digests;
  const encoder = new TextEncoder();
  for (const entry of entries) {
    const digest = await subtle.digest('SHA-256', encoder.encode(entry.path));
    const hex = toHex(digest);
    if (!digests.has(hex)) digests.set(hex, entry.itemId);
  }
  return digests;
}
