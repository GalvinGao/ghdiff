import { realpath } from 'node:fs/promises';

import type { LocalDiffRange } from '../../src/lib/reviewTarget.ts';
import { git } from './git.ts';
import { revisionsToVerify, untrackedListArgs } from './gitRange.ts';

// What this command asks the repository itself, as opposed to the argument
// vectors it hands git.
//
// The first three are asked once, before the socket is bound, and everything
// about them fails in the terminal, where the developer is looking, rather than
// as a panel in a browser tab they have not opened yet: a repository that is
// not there, a branch that is a typo, and a repository with no commit in it are
// the three ways `ghdiff` cannot start, and each says which one it was. The
// last one is asked again on every request, because it is the one answer that
// changes while the developer works.

export class LaunchFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LaunchFailure';
  }
}

/**
 * The repository the command was run in.
 *
 * `--show-toplevel` answers for the innermost repository, which is the right
 * answer inside a submodule and inside a linked worktree alike: both have a
 * toplevel of their own, and both are what a developer standing in that
 * directory means by "this repository". The path is then run through
 * `realpath`, because every containment test below compares against it and a
 * root reached through a symlink would fail its own test.
 */
export async function resolveRepositoryRoot(cwd: string): Promise<string> {
  const result = await git(['rev-parse', '--show-toplevel'], cwd);
  if (!result.ok) {
    throw new LaunchFailure(
      `${cwd} is not inside a git repository. Run ghdiff from one, or run git init here first.`
    );
  }
  const root = result.stdout.trim();
  if (root.length === 0) {
    throw new LaunchFailure(
      'git did not name a repository root. Check that this directory is a working tree and not a bare repository.'
    );
  }
  return await realpath(root);
}

/**
 * Turns each revision of the range into something git can resolve, and reports
 * the first one it cannot.
 *
 * `^{commit}` is the part that matters: it makes git refuse a name that
 * resolves to a tree or a blob, which `git diff` would then fail on later and
 * further from the typo.
 */
export async function verifyRange(
  root: string,
  range: LocalDiffRange
): Promise<void> {
  for (const revision of revisionsToVerify(range)) {
    const result = await git(
      ['rev-parse', '--verify', '--quiet', `${revision}^{commit}`],
      root
    );
    if (result.ok) continue;
    if (revision === 'HEAD') {
      throw new LaunchFailure(
        'This repository has no commits yet, so there is nothing to diff against. Make one commit and run ghdiff again.'
      );
    }
    throw new LaunchFailure(
      `git cannot resolve "${revision}". Check the spelling, or fetch the branch if it is only on the remote.`
    );
  }
}

/**
 * Every file in the working tree that git is not tracking.
 *
 * Asked on each request rather than once at launch, because this is the answer
 * that moves: a file written while the browser tab is open is in the next diff
 * the reviewer loads. An answer git refused is read as none — the patch is what
 * the reviewer came for, and losing it over a listing that failed would be the
 * wrong trade.
 *
 * Split on NUL, which is what `-z` asked for, so a newline inside a filename
 * stays inside that filename.
 */
export async function listUntracked(root: string): Promise<string[]> {
  const result = await git(untrackedListArgs(), root);
  if (!result.ok) return [];
  return result.stdout.split('\0').filter((path) => path.length > 0);
}
