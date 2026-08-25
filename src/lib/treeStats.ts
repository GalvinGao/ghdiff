import type { ReviewFileEntry } from './reviewData.ts';

// Diff stats for one file tree row.
//
// The tree draws them in its own decoration lane, at the right edge of every
// row, and that lane is what makes the numbers scannable: it sits after the
// name and before the git badge, so a column of `+` figures lines up whatever
// the indentation of the row is. lib/../components/ReviewFileTree.tsx gives the
// two columns a fixed width taken from `addedDigits` and `deletedDigits`, so
// the digits of every row end on the same two pixels.

export interface TreeStat {
  addedLines: number;
  deletedLines: number;
  /** 1 for a file. For a directory, the files under it. */
  fileCount: number;
}

export interface TreeStatIndex {
  /**
   * Keyed the way @pierre/trees names a row: a file by its tree path, and a
   * directory by its tree path with a trailing slash. Holds every file and
   * every directory above it.
   */
  byPath: ReadonlyMap<string, TreeStat>;
  /** Digits in the widest addition count, so a column can be sized once. */
  addedDigits: number;
  deletedDigits: number;
}

export const EMPTY_TREE_STAT_INDEX: TreeStatIndex = {
  byPath: new Map(),
  addedDigits: 1,
  deletedDigits: 1,
};

function digits(value: number): number {
  return String(Math.max(0, Math.trunc(value))).length;
}

function add(
  byPath: Map<string, TreeStat>,
  path: string,
  entry: ReviewFileEntry
): TreeStat {
  const current = byPath.get(path);
  if (current == null) {
    const created: TreeStat = {
      addedLines: entry.addedLines,
      deletedLines: entry.deletedLines,
      fileCount: 1,
    };
    byPath.set(path, created);
    return created;
  }
  current.addedLines += entry.addedLines;
  current.deletedLines += entry.deletedLines;
  current.fileCount += 1;
  return current;
}

/**
 * Stats for every row the tree can draw, files and directories alike.
 *
 * A directory carries the sum of everything below it. That is the number worth
 * having when the question is which part of a pull request the afternoon will
 * go on, and the tree keeps its directories open, so the sum sits directly
 * above the files it counts. The caller passes the files the filter kept, so a
 * directory total is always the sum of the rows the tree lists under it.
 *
 * The widest numbers come out of the same pass. They size the two columns, and
 * a directory total is the widest number in the tree, so the columns are wide
 * enough for every row before the first one is painted.
 */
export function buildTreeStatIndex(
  entries: readonly ReviewFileEntry[]
): TreeStatIndex {
  const byPath = new Map<string, TreeStat>();
  let addedMax = 0;
  let deletedMax = 0;

  for (const entry of entries) {
    const segments = entry.treePath.split('/');
    // Every directory above the file, then the file. `slice` per segment is
    // fine: a tree path is a handful of segments, and this runs once per diff.
    // A directory takes the trailing slash the tree gives its own rows.
    for (let depth = 1; depth <= segments.length; depth++) {
      const joined = segments.slice(0, depth).join('/');
      const key = depth === segments.length ? joined : `${joined}/`;
      const stat = add(byPath, key, entry);
      addedMax = Math.max(addedMax, stat.addedLines);
      deletedMax = Math.max(deletedMax, stat.deletedLines);
    }
  }

  return {
    byPath,
    addedDigits: digits(addedMax),
    deletedDigits: digits(deletedMax),
  };
}
