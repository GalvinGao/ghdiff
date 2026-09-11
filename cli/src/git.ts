import { type ChildProcess, spawn } from 'node:child_process';
import type { ServerResponse } from 'node:http';

// Every call this command makes to git. One function collects a small answer,
// one streams a big one, and one streams several into a single body; none of
// them goes near a shell, because an argument vector is passed straight to
// `git` and so nothing in a branch name or a path can become a second command.

export class GitFailure extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitFailure';
    this.status = status;
  }
}

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Runs git and collects its whole output. For the small answers only. */
export function git(args: readonly string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => reject(missingGit(error)));
    child.on('close', (code) =>
      resolve({ ok: code === 0, stdout, stderr: stderr.trim() })
    );
  });
}

/** One git invocation in a sequence that answers as one body. */
export interface GitStep {
  args: readonly string[];
  /**
   * True when this step failing is the whole answer failing.
   *
   * The tracked diff is required: nothing to say means nothing to show. An
   * untracked file's own diff is not, for two reasons. `git diff --no-index`
   * exits 1 when it finds differences, which is every ordinary run of it — so
   * the exit code cannot be read as a failure at all, and whether the step
   * wrote anything is the test instead. And a file listed a moment ago can be
   * gone by the time git is asked for it: the working tree moves under the
   * reader, and one vanished file must not cost the reviewer the patch.
   */
  required?: boolean;
  /**
   * Written to the child's stdin, which is then closed. How the untracked paths
   * reach `git add`: there can be thousands, and argv has a limit a pipe has
   * not.
   */
  stdin?: string;
  /**
   * Added to the child's environment — `GIT_INDEX_FILE` and
   * `GIT_OBJECT_DIRECTORY`, which keep the untracked steps out of the
   * repository being read.
   */
  env?: Record<string, string>;
}

interface StepResult {
  /** Whether this step wrote a byte of stdout. */
  wrote: boolean;
  code: number | null;
  stderr: string;
}

/**
 * Runs git and hands its output straight to the browser as it arrives.
 *
 * A patch runs to tens of megabytes, so nothing here holds one: the child's
 * stdout is pumped into the response with the backpressure respected, which is
 * the same promise the hosted `/api/diff` makes for GitHub's own body.
 *
 * The first chunk is what decides the status. git writes its failures to stderr
 * and exits before it has written a byte of stdout — a revision that does not
 * resolve, a repository that is not there — so a run that produced output is a
 * run that worked, and one that closed without any is one to report. A failure
 * *after* the first chunk cannot be reported, because the status has gone: it
 * ends the body early instead, and the browser reads a patch that stops.
 */
export function streamGit(options: {
  args: readonly string[];
  cwd: string;
  response: ServerResponse;
  headers: Record<string, string>;
  /** Turns git's own stderr into the sentence the browser is given. */
  describeFailure(stderr: string): { status: number; message: string };
}): Promise<void> {
  const { args, ...rest } = options;
  return streamGitSteps({ ...rest, steps: [{ args, required: true }] });
}

/**
 * Several git invocations, one after another, into one body.
 *
 * This is how the working tree's patch is assembled: `git diff HEAD`, and then
 * one `git diff --no-index` per untracked file. The rule above is unchanged and
 * simply reaches across the whole sequence — the first byte any child writes is
 * what sends the status, and after that there is no status left to change. So a
 * required step that fails having written nothing is still the failure the
 * browser is told about, and one that fails having written something ends the
 * body where it stopped rather than appending a second patch to a truncated
 * one.
 *
 * The untracked files land as one block after the tracked ones. The tree sorts
 * by path and does not notice; the diff scroll keeps them together at the end,
 * which is where a reviewer looking for what is not committed yet expects them.
 */
export function streamGitSteps(options: {
  steps: readonly GitStep[];
  cwd: string;
  response: ServerResponse;
  headers: Record<string, string>;
  describeFailure(stderr: string): { status: number; message: string };
}): Promise<void> {
  const { cwd, describeFailure, headers, response, steps } = options;
  let started = false;
  let child: ChildProcess | undefined;
  let abandoned = false;

  // The reviewer navigated away or pressed reload while a large patch was in
  // flight. Nothing is reading the pipe any more, so the child goes too — and
  // no later step is started, or a closed tab would go on spawning git.
  response.on('close', () => {
    if (response.writableEnded) return;
    abandoned = true;
    child?.kill('SIGKILL');
  });

  const run = (step: GitStep): Promise<StepResult> =>
    new Promise((resolve, reject) => {
      const spawned = spawn('git', step.args, {
        cwd,
        env: step.env == null ? process.env : { ...process.env, ...step.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // A constant `stdio` tuple, so `stdout` and `stderr` stay typed as
      // streams; a step with nothing to send closes stdin empty. The error
      // handler is for a child that exits before reading it all, which must
      // fail that step and not the request.
      spawned.stdin.on('error', () => {});
      spawned.stdin.end(step.stdin ?? '');
      child = spawned;
      let wrote = false;
      let stderr = '';

      spawned.stderr.setEncoding('utf8');
      spawned.stderr.on('data', (chunk: string) => {
        // Enough for a sentence. git does not write megabytes of diagnostics,
        // and an unbounded string here would be a way to make it try.
        if (stderr.length < 4096) stderr += chunk;
      });

      spawned.stdout.on('data', (chunk: Buffer) => {
        wrote = true;
        if (!started) {
          started = true;
          response.writeHead(200, headers);
        }
        if (!response.write(chunk)) {
          spawned.stdout.pause();
          response.once('drain', () => spawned.stdout.resume());
        }
      });

      spawned.on('error', (error) => reject(missingGit(error)));
      spawned.on('close', (code) => {
        child = undefined;
        resolve({ wrote, code, stderr: stderr.trim() });
      });
    });

  return (async () => {
    for (const step of steps) {
      if (abandoned) return;
      const result = await run(step);
      if (result.code === 0 || step.required !== true) continue;
      // A required step that wrote and then failed has no status left to
      // report with, so the body ends where it stopped.
      if (result.wrote) break;
      const failure = describeFailure(result.stderr);
      throw new GitFailure(failure.status, failure.message);
    }
    if (abandoned) return;
    if (!started) {
      // An empty diff is a real answer: nothing has changed yet. The viewer
      // draws its own empty state for a patch with no files in it.
      response.writeHead(200, headers);
    }
    response.end();
  })();
}

/**
 * The one failure that is not about this repository at all. `spawn` reports a
 * missing executable as ENOENT on the child, and "git: ENOENT" is not a
 * sentence anybody can act on.
 */
function missingGit(error: unknown): Error {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    return new GitFailure(
      500,
      'git is not on this machine, or not on PATH. Install git and run the command again.'
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}
