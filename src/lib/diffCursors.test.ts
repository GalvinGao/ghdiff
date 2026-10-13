import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { gitLabPositionForAnchor } from './diffCursors';

/**
 * One hunk of a modified file, every row kind present. Counters start at
 * old=10, new=10:
 *
 *   ' context A'  (10, 10)   '-old B'  (11, 11 hidden new)
 *   '+new C'      (12 hidden old, 11) '+new D' (12 hidden old, 12)
 *   ' context E'  (12, 13)
 */
const MODIFIED = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,3 +10,4 @@
 context A
-old B
+new C
+new D
 context E
`;

const RENAMED = `diff --git a/old.ts b/new.ts
similarity index 86%
rename from old.ts
rename to new.ts
index 1111111..2222222 100644
--- a/old.ts
+++ b/new.ts
@@ -1,2 +1,2 @@
-old x
+new y
 context z
`;

const ADDED_FILE = `diff --git a/added.ts b/added.ts
new file mode 100644
index 0000000..2222222
--- /dev/null
+++ b/added.ts
@@ -0,0 +1,2 @@
+line one
+line two
`;

const DELETED_FILE = `diff --git a/gone.ts b/gone.ts
deleted file mode 100644
index 1111111..0000000
--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-bye one
-bye two
`;

const TWO_HUNKS = `diff --git a/m.ts b/m.ts
index 1111111..2222222 100644
--- a/m.ts
+++ b/m.ts
@@ -5,3 +5,3 @@
 alpha
-bravo
+charlie
 delta
@@ -20,2 +20,2 @@
 echo
-foxtrot
+golf
`;

/** A hunk that inserts at the top of an existing file: the old cursor starts at 0. */
const INSERT_AT_TOP = `diff --git a/top.ts b/top.ts
index 1111111..2222222 100644
--- a/top.ts
+++ b/top.ts
@@ -0,0 +1,2 @@
+first
+second
`;

/** The same file changed in two commits of one patch; the anchor is in the second. */
const TWO_COMMITS = `diff --git a/x.ts b/x.ts
index 1111111..2222222 100644
--- a/x.ts
+++ b/x.ts
@@ -1,1 +1,1 @@
-old
+new
diff --git a/y.ts b/y.ts
index 3333333..4444444 100644
--- a/y.ts
+++ b/y.ts
@@ -7,1 +7,1 @@
-old y
+new y
diff --git a/x.ts b/x.ts
index 2222222..5555555 100644
--- a/x.ts
+++ b/x.ts
@@ -40,1 +40,1 @@
-old2
+new2
`;

const QUOTED_PATH = `diff --git "a/has space.ts" "b/has space.ts"
index 1111111..2222222 100644
--- "a/has space.ts"
+++ "b/has space.ts"
@@ -1,1 +1,1 @@
-a
+b
`;

describe('gitLabPositionForAnchor', () => {
  it('states an addition by its new cursor, with the old cursor it hides', () => {
    const position = gitLabPositionForAnchor(MODIFIED, 'src/a.ts', {
      line: 11,
      side: 'additions',
    });
    assert.deepEqual(position, {
      oldPath: 'src/a.ts',
      newPath: 'src/a.ts',
      end: { oldPos: 12, newPos: 11, kind: 'addition' },
    });
  });

  it('states a deletion by its old cursor, with the new cursor it hides', () => {
    const position = gitLabPositionForAnchor(MODIFIED, 'src/a.ts', {
      line: 11,
      side: 'deletions',
    });
    assert.deepEqual(position, {
      oldPath: 'src/a.ts',
      newPath: 'src/a.ts',
      end: { oldPos: 11, newPos: 11, kind: 'deletion' },
    });
  });

  it('states a context row by both cursors, from either side', () => {
    const fromNew = gitLabPositionForAnchor(MODIFIED, 'src/a.ts', {
      line: 13,
      side: 'additions',
    });
    assert.deepEqual(fromNew?.end, { oldPos: 12, newPos: 13, kind: 'context' });
    const fromOld = gitLabPositionForAnchor(MODIFIED, 'src/a.ts', {
      line: 12,
      side: 'deletions',
    });
    assert.deepEqual(fromOld?.end, { oldPos: 12, newPos: 13, kind: 'context' });
  });

  it('answers for the first and the last row of a hunk', () => {
    const first = gitLabPositionForAnchor(MODIFIED, 'src/a.ts', {
      line: 10,
      side: 'additions',
    });
    assert.deepEqual(first?.end, { oldPos: 10, newPos: 10, kind: 'context' });
    const last = gitLabPositionForAnchor(MODIFIED, 'src/a.ts', {
      line: 13,
      side: 'additions',
    });
    assert.deepEqual(last?.end, { oldPos: 12, newPos: 13, kind: 'context' });
  });

  it('states a multiline range from both rows, same side', () => {
    const position = gitLabPositionForAnchor(MODIFIED, 'src/a.ts', {
      line: 12,
      side: 'additions',
      startLine: 11,
      startSide: 'additions',
    });
    assert.deepEqual(position, {
      oldPath: 'src/a.ts',
      newPath: 'src/a.ts',
      end: { oldPos: 12, newPos: 12, kind: 'addition' },
      start: { oldPos: 12, newPos: 11, kind: 'addition' },
    });
  });

  it('reads a range whose start is its end as a single line', () => {
    const position = gitLabPositionForAnchor(MODIFIED, 'src/a.ts', {
      line: 11,
      side: 'additions',
      startLine: 11,
      startSide: 'additions',
    });
    assert.equal(position?.start, undefined);
    assert.deepEqual(position?.end, {
      oldPos: 12,
      newPos: 11,
      kind: 'addition',
    });
  });

  it('has no answer for a range that crosses sides', () => {
    const position = gitLabPositionForAnchor(MODIFIED, 'src/a.ts', {
      line: 12,
      side: 'additions',
      startLine: 11,
      startSide: 'deletions',
    });
    assert.equal(position, undefined);
  });

  it('has no answer when the start row is not in the diff', () => {
    const position = gitLabPositionForAnchor(MODIFIED, 'src/a.ts', {
      line: 12,
      side: 'additions',
      startLine: 999,
      startSide: 'additions',
    });
    assert.equal(position, undefined);
  });

  it('has no answer when the anchor names no row of the file', () => {
    assert.equal(
      gitLabPositionForAnchor(MODIFIED, 'src/a.ts', {
        line: 999,
        side: 'additions',
      }),
      undefined
    );
  });

  it('has no answer when the file is not in the patch', () => {
    assert.equal(
      gitLabPositionForAnchor(MODIFIED, 'src/missing.ts', {
        line: 11,
        side: 'additions',
      }),
      undefined
    );
  });

  it('states both real paths of a renamed file', () => {
    const position = gitLabPositionForAnchor(RENAMED, 'new.ts', {
      line: 1,
      side: 'additions',
    });
    assert.deepEqual(position, {
      oldPath: 'old.ts',
      newPath: 'new.ts',
      end: { oldPos: 2, newPos: 1, kind: 'addition' },
    });
  });

  it('matches a renamed file by its old path too', () => {
    const position = gitLabPositionForAnchor(RENAMED, 'old.ts', {
      line: 1,
      side: 'deletions',
    });
    assert.deepEqual(position, {
      oldPath: 'old.ts',
      newPath: 'new.ts',
      end: { oldPos: 1, newPos: 1, kind: 'deletion' },
    });
  });

  it('has no answer for an added file: the hidden old cursor is 0', () => {
    assert.equal(
      gitLabPositionForAnchor(ADDED_FILE, 'added.ts', {
        line: 1,
        side: 'additions',
      }),
      undefined
    );
  });

  it('has no answer for a deleted file: the hidden new cursor is 0', () => {
    assert.equal(
      gitLabPositionForAnchor(DELETED_FILE, 'gone.ts', {
        line: 1,
        side: 'deletions',
      }),
      undefined
    );
  });

  it('has no answer for a hunk that inserts at the top of a file', () => {
    assert.equal(
      gitLabPositionForAnchor(INSERT_AT_TOP, 'top.ts', {
        line: 1,
        side: 'additions',
      }),
      undefined
    );
  });

  it('finds the anchor row across several hunks of one file', () => {
    const first = gitLabPositionForAnchor(TWO_HUNKS, 'm.ts', {
      line: 6,
      side: 'additions',
    });
    assert.deepEqual(first?.end, { oldPos: 7, newPos: 6, kind: 'addition' });
    const second = gitLabPositionForAnchor(TWO_HUNKS, 'm.ts', {
      line: 21,
      side: 'additions',
    });
    assert.deepEqual(second?.end, { oldPos: 22, newPos: 21, kind: 'addition' });
    const deletion = gitLabPositionForAnchor(TWO_HUNKS, 'm.ts', {
      line: 6,
      side: 'deletions',
    });
    assert.deepEqual(deletion?.end, { oldPos: 6, newPos: 6, kind: 'deletion' });
  });

  it('finds the anchor across a patch that holds the file once per commit', () => {
    const early = gitLabPositionForAnchor(TWO_COMMITS, 'x.ts', {
      line: 1,
      side: 'additions',
    });
    assert.deepEqual(early?.end, { oldPos: 2, newPos: 1, kind: 'addition' });
    const late = gitLabPositionForAnchor(TWO_COMMITS, 'x.ts', {
      line: 40,
      side: 'additions',
    });
    assert.deepEqual(late?.end, { oldPos: 41, newPos: 40, kind: 'addition' });
  });

  it('matches a quoted path with a space in it', () => {
    const position = gitLabPositionForAnchor(QUOTED_PATH, 'has space.ts', {
      line: 1,
      side: 'additions',
    });
    assert.deepEqual(position, {
      oldPath: 'has space.ts',
      newPath: 'has space.ts',
      end: { oldPos: 2, newPos: 1, kind: 'addition' },
    });
  });
});
