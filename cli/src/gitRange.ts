import type { LocalDiffRange } from '../../src/lib/reviewTarget.ts';

// The argument vectors this command hands to git, and nothing else. Pure, so
// the four ranges are pinned by a test rather than by reading a diff on screen.

/**
 * On every `git diff` this command makes.
 *
 * The first three are about a developer's own configuration: `diff.external`,
 * `textconv` and a forced colour can each turn `git diff` into something that
 * is not a patch at all, and the browser is parsing a patch. `-M` is about the
 * viewer: it draws a `rename-changed` file, and rename detection is the only
 * thing that produces one.
 */
export const DIFF_FLAGS = [
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '-M',
] as const;

/** The `git diff` that answers `/api/diff` for this range. */
export function diffArgs(range: LocalDiffRange): string[] {
  switch (range.mode) {
    // Tracked changes against the last commit — staged and unstaged together,
    // which is what "what have I done so far" means. The files git is not
    // tracking are not in this one and cannot be: they are read separately,
    // by the two functions below.
    case 'worktree':
      return ['diff', ...DIFF_FLAGS, 'HEAD'];
    case 'staged':
      return ['diff', ...DIFF_FLAGS, '--cached'];
    // The merge-base range, not the two-dot one: a branch review is what this
    // branch did, and never what happened on main while it was away. It is
    // also what github.com's own compare page shows.
    case 'branch':
      return ['diff', ...DIFF_FLAGS, `${range.base}...HEAD`];
    case 'range':
      return ['diff', ...DIFF_FLAGS, `${range.base}...${range.head}`];
  }
}

/**
 * Whether this range has untracked files in it at all.
 *
 * Only the working tree does. `--staged` is what is about to land and a file
 * git has never been told about is not; `branch` and `range` are two commits,
 * and every file in a commit is tracked by definition.
 */
export function rangeShowsUntracked(range: LocalDiffRange): boolean {
  return range.mode === 'worktree';
}

/**
 * Every file in the working tree that git is not tracking and is not ignoring.
 *
 * `-z` because the answer is a list of paths and a path is allowed to contain a
 * newline. `--exclude-standard` is what keeps `.gitignore` out of it, so this
 * is the same set `git status` calls untracked rather than every file on disk.
 */
export function untrackedListArgs(): string[] {
  return ['ls-files', '--others', '--exclude-standard', '-z'];
}

/**
 * Stages every untracked path as an intent-to-add, into an index that is not
 * this repository's — the first half of showing untracked files in two spawns
 * rather than one per file.
 *
 * That index is temporary and **empty**, and empty is load-bearing: a tracked
 * file is not in it, so the diff below needs no pathspec and cannot report an
 * unstaged change the range's own diff has already reported.
 * `GIT_OBJECT_DIRECTORY` is what makes staging safe here at all — `-N` writes
 * the empty blob, and that variable sends it to the same temporary directory
 * instead of `.git/objects`, so this command still writes nothing into the
 * repository it is reading.
 *
 * Paths arrive on stdin because a repository with nothing ignored answers with
 * thousands and an argument vector has a limit; the framing is the `-z` one
 * `untrackedListArgs` already asked for. Needs git 2.25 for
 * `--pathspec-from-file`, and neither untracked step is `required`, so an older
 * git costs that block and never the patch.
 */
export function untrackedStageArgs(): string[] {
  return ['add', '-N', '--pathspec-from-file=-', '--pathspec-file-nul'];
}

/**
 * The patch for everything staged above: that index against the working tree.
 * No revision and no pathspec, because it holds the untracked paths and nothing
 * else.
 *
 * A symlink is diffed as a symlink — mode 120000 with its target as the one
 * line — so an untracked link pointing out of the repository leaks nothing but
 * its own text.
 */
export function untrackedDiffArgs(): string[] {
  return ['diff', ...DIFF_FLAGS];
}

/**
 * Where the new side of this range's patch lives, which is what a hunk
 * expansion reads.
 *
 * `worktree` is the one that is a path on disk: the new side of `git diff HEAD`
 * is the file as it is right now, which no object in the database holds. Every
 * other range names a tree git can read, so the answer is an object and the
 * filesystem is not touched at all.
 */
export type NewSideSource =
  | { from: 'worktree' }
  | { from: 'object'; rev: string };

export function newSideSource(range: LocalDiffRange): NewSideSource {
  switch (range.mode) {
    case 'worktree':
      return { from: 'worktree' };
    // `:0:` is the index's own stage, which is precisely what `--cached`
    // diffed against HEAD.
    case 'staged':
      return { from: 'object', rev: ':0' };
    case 'branch':
      return { from: 'object', rev: 'HEAD' };
    case 'range':
      return { from: 'object', rev: range.head };
  }
}

/**
 * The `git show` that reads one file out of a tree. The path goes after the
 * revision and a colon, which is git's own spelling, and it resolves against
 * the repository root because every call this command makes runs there.
 */
export function showArgs(rev: string, path: string): string[] {
  return ['show', `${rev}:${path}`];
}

/**
 * The revisions this range needs git to be able to resolve before the server
 * starts. Answered at launch so a typo fails in the terminal, where the
 * developer is looking, rather than as a panel in a browser tab.
 */
export function revisionsToVerify(range: LocalDiffRange): string[] {
  switch (range.mode) {
    case 'worktree':
    case 'staged':
      return ['HEAD'];
    case 'branch':
      return [range.base, 'HEAD'];
    case 'range':
      return [range.base, range.head];
  }
}
