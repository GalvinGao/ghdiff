// GitLab diff positions, computed from the unified diff itself.
//
// A GitLab note anchors to a row of the merge request's diff, and GitLab
// derives that anchor from raw cursors: the line numbers a row carries in
// each of the two files, the one a single-coordinate note hides included. A
// comment written here can state them exactly, because this app holds the
// whole patch — and stating them is the only way a renamed file or a context
// line lands where the comment was written.
//
// The cursor rules, walked row by row through a hunk's rows:
//
// - A context row (' ') is a real line in both files: both cursors name it,
//   and both advance.
// - A deletion ('-') is a real line of the old file only; the new cursor is
//   hidden and stays where it is.
// - An addition ('+') is a real line of the new file only; the old cursor is
//   hidden and stays where it is.
//
// So the hidden value is the counter at the row — the count of that side's
// lines consumed so far, which is the number the next row on that side will
// carry. It is never synthesized: where the honest value is 0 (a new or a
// deleted file, or a hunk that inserts at the top of a file) the position has
// no answer, and the caller falls back to the scalar `path`/`line`/`side`
// shape it has always sent.

/** One end of a GitLab diff position: raw cursors on both sides of the diff. */
export interface GitLabDiffCursor {
  oldPos: number;
  newPos: number;
  kind: 'addition' | 'deletion' | 'context';
}

/** A GitLab diff position, in the wire shape `src/lib/rpc/contract.ts` states. */
export interface GitLabDiffPosition {
  oldPath: string;
  newPath: string;
  end: GitLabDiffCursor;
  start?: GitLabDiffCursor;
}

/** A scalar diff anchor: one line on one side, or a same-side range. */
export interface DiffAnchor {
  line: number;
  side: 'additions' | 'deletions';
  startLine?: number;
  startSide?: 'additions' | 'deletions';
}

interface CursorRow {
  kind: 'addition' | 'deletion' | 'context';
  oldPos: number;
  newPos: number;
}

const DEV_NULL = '/dev/null';

/** `--- a/path` or `+++ b/path` to a repository-relative path, or undefined for `/dev/null`. */
function headerPath(raw: string, prefix: 'a' | 'b'): string | undefined {
  let path = raw.trim();
  if (path === DEV_NULL) return undefined;
  if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) {
    // Git quotes a path with special characters. Only the two escapes that
    // cannot corrupt a path are undone; anything else stays quoted, fails to
    // match, and the caller falls back to the scalar shape.
    path = path.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  const head = `${prefix}/`;
  return path.startsWith(head) ? path.slice(head.length) : path;
}

/**
 * The patch cut into per-file chunks, each starting at its `diff --git` line.
 * Only chunks that can hold the anchor are parsed further.
 */
function* sectionTexts(patch: string): Generator<string> {
  let start = -1;
  let index = 0;
  while (index < patch.length) {
    const lineEnd = patch.indexOf('\n', index);
    const line = patch.slice(index, lineEnd === -1 ? patch.length : lineEnd);
    if (line.startsWith('diff --git ')) {
      if (start !== -1) yield patch.slice(start, index);
      start = index;
    }
    if (lineEnd === -1) break;
    index = lineEnd + 1;
  }
  if (start !== -1) yield patch.slice(start);
}

/** A chunk's two paths, read from the `---`/`+++` pair ahead of its first hunk. */
function sectionPaths(section: string): {
  oldPath?: string;
  newPath?: string;
} {
  const paths: { oldPath?: string; newPath?: string } = {};
  for (const line of section.split('\n')) {
    if (line.startsWith('@@ ')) break;
    if (line.startsWith('--- ')) {
      paths.oldPath = headerPath(line.slice(4), 'a');
    } else if (line.startsWith('+++ ')) {
      paths.newPath = headerPath(line.slice(4), 'b');
    }
  }
  return paths;
}

/**
 * Every row of a chunk's hunks, with both cursors filled at the row. The
 * hunk headers' counts are authoritative: a hunk ends when its two counts
 * are spent, whatever the lines after it look like.
 */
function sectionRows(section: string): CursorRow[] {
  const rows: CursorRow[] = [];
  let oldPos = 0;
  let newPos = 0;
  let oldLeft = 0;
  let newLeft = 0;
  let inHunk = false;
  for (const line of section.split('\n')) {
    if (!inHunk) {
      const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (header == null) continue;
      oldPos = Number(header[1]);
      newPos = Number(header[3]);
      oldLeft = header[2] === undefined ? 1 : Number(header[2]);
      newLeft = header[4] === undefined ? 1 : Number(header[4]);
      inHunk = oldLeft > 0 || newLeft > 0;
      continue;
    }
    const sign = line.charAt(0);
    // An empty line is not a row git emits, but read as context it keeps the
    // counters aligned with the counts the hunk header stated.
    if (sign === ' ' || sign === '') {
      rows.push({ kind: 'context', oldPos, newPos });
      oldPos += 1;
      newPos += 1;
      oldLeft -= 1;
      newLeft -= 1;
    } else if (sign === '-') {
      rows.push({ kind: 'deletion', oldPos, newPos });
      oldPos += 1;
      oldLeft -= 1;
    } else if (sign === '+') {
      rows.push({ kind: 'addition', oldPos, newPos });
      newPos += 1;
      newLeft -= 1;
    }
    if (oldLeft <= 0 && newLeft <= 0) inHunk = false;
  }
  return rows;
}

/**
 * The row a scalar anchor names: the one carrying `line` on the anchor's
 * side. A context row answers on either side; a '+' row only on the new one,
 * a '-' row only on the old one. Within a hunk no two rows share a number on
 * one side, so the match cannot be ambiguous.
 */
function findRow(
  rows: readonly CursorRow[],
  side: 'additions' | 'deletions',
  line: number
): CursorRow | undefined {
  for (const row of rows) {
    if (side === 'additions') {
      if (row.kind !== 'deletion' && row.newPos === line) return row;
    } else if (row.kind !== 'addition' && row.oldPos === line) {
      return row;
    }
  }
  return undefined;
}

/** Every cursor a position states is positive: the contract admits no zero. */
function honest(cursor: GitLabDiffCursor): boolean {
  return cursor.oldPos > 0 && cursor.newPos > 0;
}

/**
 * The GitLab diff position for a scalar anchor on one file of the patch, or
 * undefined when the patch cannot state it exactly — the anchor names no row
 * of the file, the file is not in the patch, a range crosses sides, or an
 * honest cursor would be 0. The caller sends the scalar shape in that case,
 * which is what it has always sent.
 *
 * `path` is the file's rendered path — the new one for a rename, matching the
 * `+++` side; a deleted file matches the `---` side.
 */
export function gitLabPositionForAnchor(
  patch: string,
  path: string,
  anchor: DiffAnchor
): GitLabDiffPosition | undefined {
  for (const section of sectionTexts(patch)) {
    const { oldPath, newPath } = sectionPaths(section);
    if (oldPath !== path && newPath !== path) continue;
    const rows = sectionRows(section);
    const endRow = findRow(rows, anchor.side, anchor.line);
    // The path matched but the row is not in this section: a multi-commit
    // patch can hold the same file once per commit. Another section may.
    if (endRow == null) continue;

    let startRow: CursorRow | undefined;
    // The server's scalar shape treats a range whose start is its end as a
    // single line; this side mirrors that.
    if (anchor.startLine != null && anchor.startLine !== anchor.line) {
      const startSide = anchor.startSide ?? anchor.side;
      if (startSide !== anchor.side) return undefined;
      startRow = findRow(rows, startSide, anchor.startLine);
      if (startRow == null) return undefined;
    }

    const end: GitLabDiffCursor = {
      oldPos: endRow.oldPos,
      newPos: endRow.newPos,
      kind: endRow.kind,
    };
    const start: GitLabDiffCursor | undefined =
      startRow == null
        ? undefined
        : {
            oldPos: startRow.oldPos,
            newPos: startRow.newPos,
            kind: startRow.kind,
          };
    if (!honest(end) || (start != null && !honest(start))) return undefined;

    // A missing side is a file Git added or deleted: the other side's path is
    // the only name the file has. The cursor check above has already decided
    // whether the case has an honest answer at all.
    const resolvedOldPath = oldPath ?? newPath;
    const resolvedNewPath = newPath ?? oldPath;
    if (resolvedOldPath == null || resolvedNewPath == null) return undefined;

    return start == null
      ? { oldPath: resolvedOldPath, newPath: resolvedNewPath, end }
      : { oldPath: resolvedOldPath, newPath: resolvedNewPath, end, start };
  }
  return undefined;
}
