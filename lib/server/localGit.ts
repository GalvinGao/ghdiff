import { execFile } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { LOCAL_HEAD_STAGED, LOCAL_HEAD_WORKTREE } from '../reviewTarget.ts';

// Reviewer runs `git` against a repository the user names, so every value that
// reaches the command line is validated first. The command is spawned with an
// argv array and no shell, and each ref is checked with `git rev-parse` before
// it is used, so a ref cannot turn into an option.

const MAX_DIFF_BYTES = 64 * 1024 * 1024;

export class LocalGitError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'LocalGitError';
    this.status = status;
  }
}

/**
 * Local git is on for development and off on a deployed host, because a public
 * deployment must not read the server's disk. Set REVIEWER_LOCAL_GIT to 'on' or
 * 'off' to decide explicitly.
 */
export function isLocalGitEnabled(): boolean {
  const setting = process.env.REVIEWER_LOCAL_GIT;
  if (setting === 'off') return false;
  if (setting === 'on') return true;
  return process.env.VERCEL == null && process.env.NODE_ENV !== 'production';
}

/** Every repository must sit under this directory. Defaults to the home dir. */
export function localGitRoot(): string {
  const configured = process.env.REVIEWER_LOCAL_GIT_ROOT?.trim();
  return path.resolve(
    configured != null && configured.length > 0 ? configured : homedir()
  );
}

function expandHome(input: string): string {
  if (input === '~') return homedir();
  if (input.startsWith('~/')) return path.join(homedir(), input.slice(2));
  return input;
}

/** Resolves and authorizes a repository path. Throws LocalGitError otherwise. */
export async function resolveRepoPath(input: string): Promise<string> {
  if (!isLocalGitEnabled()) {
    throw new LocalGitError(
      403,
      'Local git review is disabled on this server.'
    );
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new LocalGitError(400, 'Give a repository path.');
  }
  if (trimmed.includes('\0')) {
    throw new LocalGitError(400, 'That repository path is not valid.');
  }

  const resolved = path.resolve(expandHome(trimmed));
  const root = localGitRoot();
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new LocalGitError(
      403,
      `That repository is outside ${root}. Set REVIEWER_LOCAL_GIT_ROOT to widen the range.`
    );
  }

  const stats = await stat(resolved).catch(() => undefined);
  if (stats == null || !stats.isDirectory()) {
    throw new LocalGitError(404, `No directory at ${resolved}.`);
  }
  // A linked worktree has a `.git` file rather than a directory.
  const gitEntry = path.join(resolved, '.git');
  const hasGit = await access(gitEntry).then(
    () => true,
    () => false
  );
  if (!hasGit) {
    throw new LocalGitError(400, `${resolved} is not a git repository.`);
  }

  return resolved;
}

function runGit(
  repoPath: string,
  args: readonly string[],
  maxBuffer = 1024 * 1024
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', repoPath, ...args],
      { maxBuffer, encoding: 'utf8', windowsHide: true },
      (error, stdout, stderr) => {
        if (error != null) {
          const message =
            stderr.trim().length > 0 ? stderr.trim() : error.message;
          reject(new LocalGitError(400, message));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/@^~-]*$/;

/** Confirms a ref exists in this repository and is not an option. */
export async function verifyRef(
  repoPath: string,
  ref: string
): Promise<string> {
  const trimmed = ref.trim();
  if (!REF_PATTERN.test(trimmed)) {
    throw new LocalGitError(400, `"${ref}" is not a valid git ref.`);
  }
  // `rev-parse --quiet` prints nothing and exits 1 for an unknown ref, so
  // runGit would surface the raw command line. Say what the reviewer needs.
  try {
    await runGit(repoPath, [
      'rev-parse',
      '--verify',
      '--quiet',
      `${trimmed}^{commit}`,
    ]);
  } catch {
    throw new LocalGitError(
      404,
      `"${trimmed}" is not a commit in this repository.`
    );
  }
  return trimmed;
}

export interface LocalDiffRequest {
  repoPath: string;
  base: string;
  head: string;
}

/** Builds the `git diff` argv for a base and head pair. */
export async function localDiffArgs(
  request: LocalDiffRequest
): Promise<string[]> {
  const base = await verifyRef(request.repoPath, request.base);
  const common = ['diff', '--no-color', '--no-ext-diff', '--find-renames'];

  if (request.head === LOCAL_HEAD_WORKTREE) {
    return [...common, base, '--'];
  }
  if (request.head === LOCAL_HEAD_STAGED) {
    return [...common, '--cached', base, '--'];
  }
  const head = await verifyRef(request.repoPath, request.head);
  // Three dots so the diff shows what head added since the merge base, which
  // is what a reviewer wants and what GitHub shows for a pull request.
  return [...common, `${base}...${head}`, '--'];
}

/** Runs `git diff` and returns the patch text. */
export async function readLocalDiff(
  request: LocalDiffRequest
): Promise<string> {
  const args = await localDiffArgs(request);
  return runGit(request.repoPath, args, MAX_DIFF_BYTES);
}

export interface LocalRepoInfo {
  repoPath: string;
  currentBranch: string;
  defaultBase: string;
  branches: string[];
  hasStagedChanges: boolean;
  hasWorktreeChanges: boolean;
}

/** Everything the local-review form needs to offer sensible defaults. */
export async function readLocalRepoInfo(
  repoPath: string
): Promise<LocalRepoInfo> {
  const [branchOutput, branchList, statusOutput] = await Promise.all([
    runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(repoPath, [
      'for-each-ref',
      '--format=%(refname:short)',
      '--sort=-committerdate',
      '--count=100',
      'refs/heads',
    ]),
    runGit(repoPath, ['status', '--porcelain']),
  ]);

  const branches = branchList
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const currentBranch = branchOutput.trim();
  const defaultBase =
    ['main', 'master', 'develop'].find(
      (candidate) => candidate !== currentBranch && branches.includes(candidate)
    ) ?? currentBranch;

  const statusLines = statusOutput
    .split('\n')
    .filter((line) => line.length > 0);

  return {
    repoPath,
    currentBranch,
    defaultBase,
    branches,
    hasStagedChanges: statusLines.some((line) => /^[MADRC]/.test(line)),
    hasWorktreeChanges: statusLines.some((line) => /^.[MADRC?]/.test(line)),
  };
}
