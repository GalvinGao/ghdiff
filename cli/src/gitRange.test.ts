import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LocalDiffRange } from '../../src/lib/reviewTarget.ts';
import {
  diffArgs,
  newSideSource,
  rangeShowsUntracked,
  revisionsToVerify,
  showArgs,
  untrackedDiffArgs,
  untrackedListArgs,
  untrackedStageArgs,
} from './gitRange.ts';

const FLAGS = ['--no-color', '--no-ext-diff', '--no-textconv', '-M'];

describe('diffArgs', () => {
  it('carries the four flags on every range', () => {
    // The first three because a developer's own git configuration can emit
    // something that is not a patch; `-M` because the viewer draws a
    // `rename-changed` file and only rename detection produces one.
    for (const range of ranges()) {
      const args = diffArgs(range);
      assert.equal(args[0], 'diff');
      for (const flag of FLAGS) assert.ok(args.includes(flag), flag);
    }
  });

  it('names what each range actually diffs', () => {
    assert.deepEqual(diffArgs({ mode: 'worktree' }), [
      'diff',
      ...FLAGS,
      'HEAD',
    ]);
    assert.deepEqual(diffArgs({ mode: 'staged' }), [
      'diff',
      ...FLAGS,
      '--cached',
    ]);
    assert.deepEqual(diffArgs({ mode: 'branch', base: 'main' }), [
      'diff',
      ...FLAGS,
      'main...HEAD',
    ]);
    assert.deepEqual(
      diffArgs({ mode: 'range', base: 'main', head: 'feature' }),
      ['diff', ...FLAGS, 'main...feature']
    );
  });

  it('uses the merge-base range and never the two-dot one', () => {
    // A branch review is what this branch did, never what happened on main
    // while it was away.
    for (const range of ranges()) {
      const spec = diffArgs(range).at(-1) ?? '';
      assert.ok(!/[^.]\.\.[^.]/.test(spec), spec);
    }
  });
});

describe('rangeShowsUntracked', () => {
  it('answers for the working tree and nothing else', () => {
    // `--staged` is what is about to land, and a file git has never been told
    // about is not. The other two are commits, where every file is tracked.
    assert.equal(rangeShowsUntracked({ mode: 'worktree' }), true);
    assert.equal(rangeShowsUntracked({ mode: 'staged' }), false);
    assert.equal(rangeShowsUntracked({ mode: 'branch', base: 'main' }), false);
    assert.equal(
      rangeShowsUntracked({ mode: 'range', base: 'main', head: 'feature' }),
      false
    );
  });
});

describe('untrackedListArgs', () => {
  it('asks for the set git status calls untracked, NUL-separated', () => {
    // `--exclude-standard` is what keeps .gitignore out of the answer, and
    // `-z` is what keeps a newline in a filename from splitting one path
    // into two.
    assert.deepEqual(untrackedListArgs(), [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
    ]);
  });
});

describe('untrackedStageArgs', () => {
  it('stages an intent-to-add, reading the paths from stdin', () => {
    // stdin and not an argument vector: a repository with nothing ignored
    // answers with thousands of paths, and argv has a limit where a pipe does
    // not. `--pathspec-file-nul` is the same framing `untrackedListArgs` asked
    // for, so a newline inside a filename stays inside that filename.
    assert.deepEqual(untrackedStageArgs(), [
      'add',
      '-N',
      '--pathspec-from-file=-',
      '--pathspec-file-nul',
    ]);
  });

  it('names no path at all, so no filename can become a flag', () => {
    // The whole reason the paths go over stdin rather than argv: a path from
    // `ls-files` is free to open with a dash, and there is no argument here
    // for one to be read as.
    assert.ok(!untrackedStageArgs().some((arg) => arg.endsWith('.ts')));
  });
});

describe('untrackedDiffArgs', () => {
  it('diffs the temporary index against the working tree', () => {
    // No revision, because the index it diffs holds the untracked paths and
    // nothing else, and no pathspec for the same reason.
    assert.deepEqual(untrackedDiffArgs(), ['diff', ...FLAGS]);
  });

  it('carries the same four flags every other diff carries', () => {
    const args = untrackedDiffArgs();
    for (const flag of FLAGS) assert.ok(args.includes(flag), flag);
  });
});

describe('newSideSource', () => {
  it('reads the disk for the working tree and an object for everything else', () => {
    assert.deepEqual(newSideSource({ mode: 'worktree' }), { from: 'worktree' });
    assert.deepEqual(newSideSource({ mode: 'staged' }), {
      from: 'object',
      rev: ':0',
    });
    assert.deepEqual(newSideSource({ mode: 'branch', base: 'main' }), {
      from: 'object',
      rev: 'HEAD',
    });
    assert.deepEqual(
      newSideSource({ mode: 'range', base: 'main', head: 'feature' }),
      { from: 'object', rev: 'feature' }
    );
  });

  it('reads the index for staged, which is what --cached diffed', () => {
    // `:0:path` is git's own spelling for the index's own stage. Reading HEAD
    // here would show the file as it was committed, which is the side
    // `--cached` diffed *from*.
    assert.deepEqual(showArgs(':0', 'src/a.ts'), ['show', ':0:src/a.ts']);
    assert.deepEqual(showArgs('HEAD', 'src/a.ts'), ['show', 'HEAD:src/a.ts']);
  });
});

describe('revisionsToVerify', () => {
  it('asks about every revision the range will use', () => {
    assert.deepEqual(revisionsToVerify({ mode: 'worktree' }), ['HEAD']);
    assert.deepEqual(revisionsToVerify({ mode: 'staged' }), ['HEAD']);
    assert.deepEqual(revisionsToVerify({ mode: 'branch', base: 'main' }), [
      'main',
      'HEAD',
    ]);
    assert.deepEqual(
      revisionsToVerify({ mode: 'range', base: 'main', head: 'feature' }),
      ['main', 'feature']
    );
  });
});

function ranges(): LocalDiffRange[] {
  return [
    { mode: 'worktree' },
    { mode: 'staged' },
    { mode: 'branch', base: 'main' },
    { mode: 'range', base: 'main', head: 'feature' },
  ];
}
