import { type ChildProcess, spawn } from 'node:child_process';

// Every call this command makes to git. One function collects a small answer
// and one turns a sequence of them into a single response body; neither goes
// near a shell, because an argument vector is passed straight to `git` and so
// nothing in a branch name or a path can become a second command.
//
// Nothing here knows what an HTTP response is. `gitStream` answers with a
// `ReadableStream`, which is what a `Response` takes, so the rule about when a
// failure may still be reported is stated once here rather than negotiated with
// a `ServerResponse` in `server.ts`.

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
   * The tracked diff is required: nothing to say means nothing to show.
   * Neither untracked step is, for two reasons. `--pathspec-from-file` wants
   * git 2.25, so an older git must cost that block and never the patch. And a
   * file listed a moment ago can be gone by the time git is asked for it: the
   * working tree moves under the reader, and one vanished file must not cost
   * the reviewer the diff they came for.
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
 * Several git invocations, one after another, as one response body.
 *
 * This is how the working tree's patch is assembled: `git diff HEAD`, and then
 * the two steps that stage the untracked files into an index of their own and
 * diff it. The untracked files land as one block after the tracked ones — the
 * tree sorts by path and does not notice, and the diff scroll keeps them
 * together at the end, which is where a reviewer looking for what is not
 * committed yet expects them.
 *
 * **The first byte decides the status, and this promise resolving is that rule
 * said out loud.** git writes its failures to stderr and exits before it has
 * written a byte of stdout — a revision that does not resolve, a repository
 * that is not there — so a run that produced output is a run that worked. This
 * function therefore answers at the first of three moments:
 *
 *  - a first chunk of stdout, with a stream that replays it and goes on;
 *  - the whole sequence done having written nothing, with an empty stream. An
 *    empty diff is a real answer: nothing has changed yet, and the viewer draws
 *    its own empty state for a patch with no files in it;
 *  - a `required` step failing having written nothing, by throwing.
 *
 * A failure *after* that has no status left to report with, so the body ends
 * where it stopped and the browser reads a patch that stops. That is the same
 * promise the old `ServerResponse` form made, and it is the reason a step that
 * may fail harmlessly carries `required: false` rather than being run first.
 *
 * Backpressure is the stream's own: a chunk is enqueued, and if the consumer
 * has not taken it the child's stdout is paused until `pull` asks for more. A
 * patch runs to tens of megabytes and nothing here holds one.
 */
export function gitStream(options: {
  steps: readonly GitStep[];
  cwd: string;
  /** Turns git's own stderr into the sentence the browser is given. */
  describeFailure(stderr: string): { status: number; message: string };
  /**
   * Run once the sequence has ended, however it ended — the last step closing,
   * a required step failing, or the reviewer navigating away.
   *
   * It belongs here rather than around the call because the steps outlive the
   * promise: this function answers at the *first* byte, and the untracked
   * files are two steps after that. A caller that cleaned up when the promise
   * resolved would remove the temporary index out from under the steps still
   * using it.
   */
  cleanup?(): Promise<void> | void;
}): Promise<ReadableStream<Uint8Array>> {
  const { cleanup, cwd, describeFailure, steps } = options;

  let child: ChildProcess | undefined;
  let paused: NodeJS.ReadableStream | undefined;
  let cancelled = false;
  let answered = false;

  return new Promise<ReadableStream<Uint8Array>>((resolve, reject) => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;

    // The reviewer navigated away or pressed reload while a large patch was in
    // flight. Nothing is reading any more, so the child goes too — and no later
    // step is started, or a closed tab would go on spawning git.
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
      },
      pull: () => {
        const stdout = paused;
        paused = undefined;
        stdout?.resume();
      },
      cancel: () => {
        cancelled = true;
        child?.kill('SIGKILL');
      },
    });

    /** The first byte: from here on there is no status left to change. */
    const answer = () => {
      if (answered) return;
      answered = true;
      resolve(stream);
    };

    const run = (step: GitStep): Promise<StepResult> =>
      new Promise<StepResult>((settle, fail) => {
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
          if (cancelled || controller == null) return;
          answer();
          controller.enqueue(chunk);
          // A default queuing strategy holds one chunk, so this is almost
          // always true and the child spends the transfer paused — which is
          // the point: the pipe, and not this process, is where a 43 MB patch
          // waits.
          if ((controller.desiredSize ?? 1) <= 0) {
            paused = spawned.stdout;
            spawned.stdout.pause();
          }
        });

        spawned.on('error', (error) => fail(missingGit(error)));
        spawned.on('close', (code) => {
          child = undefined;
          settle({ wrote, code, stderr: stderr.trim() });
        });
      });

    void (async () => {
      for (const step of steps) {
        if (cancelled) break;
        const result = await run(step);
        if (result.code === 0 || step.required !== true) continue;
        // A required step that wrote and then failed has no status left to
        // report with, so the body ends where it stopped.
        if (result.wrote) break;
        const failure = describeFailure(result.stderr);
        throw new GitFailure(failure.status, failure.message);
      }
      // Nothing was written and nothing failed: an empty answer, which the
      // caller sends as a 200 with no body.
      answer();
      if (!cancelled) controller?.close();
    })()
      .catch((error) => {
        if (answered) {
          // Past the point where a status could be sent. The body ends here.
          if (!cancelled) controller?.close();
          return;
        }
        answered = true;
        reject(error);
      })
      .finally(() => cleanup?.());
  });
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
