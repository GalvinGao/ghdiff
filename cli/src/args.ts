import {
  parseCompareRange,
  type LocalDiffRange,
} from '../../src/lib/reviewTarget.ts';

// What the command was asked for, read off `process.argv` and nothing else.
//
// Pure, and tested as such: everything here is a decision about text, and the
// git repository is not consulted. A range that parses is not a range that
// exists — `main..typo` parses fine and `git rev-parse` is what turns it down,
// with git's own sentence.

/**
 * The port this command binds when nobody names one.
 *
 * Fixed rather than free, and the reason is the browser rather than the socket.
 * `localStorage` is keyed by origin and an origin includes the port, so a run
 * on a port the kernel picked gets a storage area of its own — which threw away
 * the reviewer's comments, their viewed marks, their colour mode and their code
 * font every single time the process restarted. `reviewTargetKey` was already
 * careful to carry nothing the run decided; the area holding it was not.
 *
 * 7171 is clear of the ports a developer's own servers sit on — 3000, 4000,
 * 5000, 5173, 8000, 8080, 8888, 9000 — and below the range every OS allocates
 * ephemeral ports from (32768 and up on Linux, 49152 and up on macOS and
 * Windows), so the kernel will not hand it to an outgoing connection while a
 * review is open.
 *
 * It is not a secret and was never doing that job: a hostile page cannot reach
 * these routes whether it knows the port or not, because the token travels in a
 * custom header, no CORS header is sent, and no preflight is answered. What a
 * fixed port buys is the one thing a random one cost.
 */
export const DEFAULT_PORT = 7171;

export interface CliRun {
  /** Which diff of the repository to serve. */
  range: LocalDiffRange;
  /**
   * The port the developer named, or nothing when they named none. The absence
   * is what the server reads: a port nobody asked for may fall back to a free
   * one, and a port somebody did ask for may not.
   */
  port?: number;
  /** False when the browser is to be left alone and the URL only printed. */
  open: boolean;
}

export type ParsedArgs =
  | { kind: 'run'; run: CliRun }
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string };

/**
 * A revision this command is willing to hand to git.
 *
 * Nothing here runs through a shell — every call is `execFile`-style, with an
 * argument vector — so this is not about quoting. It is about one thing: an
 * argument that opens with `-` is read by git as a flag, and a "branch" called
 * `--output=/tmp/x` would then be one. Whitespace and control characters are
 * refused with it, because no ref has them and an argument that looks like two
 * arguments is worth turning down at the door.
 *
 * Everything else git's own revision grammar allows is let through —
 * `HEAD~2`, `v1.0^{}`, `origin/main` — because refusing them would be this
 * command inventing a rule git does not have.
 */
export function isUsableRevision(revision: string): boolean {
  if (revision.length === 0 || revision.length > 255) return false;
  if (revision.startsWith('-')) return false;
  for (const character of revision) {
    const code = character.codePointAt(0) ?? 0;
    // Every control character, the space, and DEL. No ref has one, and an
    // argument that looks like two arguments is worth turning down here.
    if (code <= 0x20 || code === 0x7f) return false;
  }
  return true;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  let staged = false;
  let open = true;
  let port: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') return { kind: 'help' };
    if (arg === '--version' || arg === '-v' || arg === '-V') {
      return { kind: 'version' };
    }
    // `--cached` is git's own name for the same thing, and a developer who
    // types `git diff --cached` all day should not have to remember which of
    // the two this command wanted.
    if (arg === '--staged' || arg === '--cached') {
      staged = true;
      continue;
    }
    if (arg === '--no-open') {
      open = false;
      continue;
    }
    if (arg === '--port' || arg.startsWith('--port=')) {
      const value =
        arg === '--port' ? argv[index + 1] : arg.slice('--port='.length);
      if (arg === '--port') index += 1;
      const parsed = parsePort(value);
      if (parsed == null) {
        return {
          kind: 'error',
          message: `--port takes a number from 1 to 65535. Got ${describe(
            value
          )}.`,
        };
      }
      port = parsed;
      continue;
    }
    // `--` is the end of the options, and everything after it is a revision.
    if (arg === '--') {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      return {
        kind: 'error',
        message: `${arg} is not an option this command has. Run ghdiff --help to see the ones it does.`,
      };
    }
    positional.push(arg);
  }

  if (positional.length > 1) {
    return {
      kind: 'error',
      message:
        'Name one revision or one range. Two refs go together as base..head.',
    };
  }

  const revision = positional[0];

  if (staged && revision != null) {
    return {
      kind: 'error',
      message:
        '--staged is the diff of the index against HEAD, so it takes no revision beside it.',
    };
  }
  if (staged)
    return { kind: 'run', run: { range: { mode: 'staged' }, port, open } };
  if (revision == null) {
    return { kind: 'run', run: { range: { mode: 'worktree' }, port, open } };
  }

  const split = parseCompareRange(revision);
  if (split != null) {
    if (!isUsableRevision(split.base) || !isUsableRevision(split.head)) {
      return { kind: 'error', message: badRevision(revision) };
    }
    return {
      kind: 'run',
      run: { range: { mode: 'range', ...split }, port, open },
    };
  }
  if (!isUsableRevision(revision)) {
    return { kind: 'error', message: badRevision(revision) };
  }
  return {
    kind: 'run',
    run: { range: { mode: 'branch', base: revision }, port, open },
  };
}

function badRevision(revision: string): string {
  return `${describe(
    revision
  )} is not a revision. Name a branch, a tag or a commit, or a range as base..head.`;
}

function parsePort(value: string | undefined): number | undefined {
  if (value == null || !/^\d{1,5}$/.test(value)) return undefined;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : undefined;
}

function describe(value: string | undefined): string {
  return value == null || value.length === 0 ? 'nothing' : `"${value}"`;
}

export const HELP = `ghdiff — read a local git diff in the ghdiff review surface

Usage
  ghdiff                  uncommitted work        git diff HEAD
  ghdiff --staged         what is about to land   git diff --cached
  ghdiff main             this branch on its base git diff main...HEAD
  ghdiff main..feature    any two revisions       git diff main...feature

Options
  --port <n>   Bind this port instead of ${DEFAULT_PORT}.
  --no-open    Print the address and leave the browser alone.
  -h, --help   This.
  -v, --version

Files you have not added yet are in the first of those, at the end of the diff.
The display menu has a switch that takes them back off.

Comments you leave, and the files you mark read, are kept by your browser under
this address, which is why the port is always ${DEFAULT_PORT} unless you say
so: change it and you will not find your earlier notes.

The server listens on 127.0.0.1 only, serves the one repository the command was
run in, and reads. It never commits, never changes your index, and never checks
anything out: your .git directory is left exactly as it was. Nothing leaves the
machine. Press Ctrl-C to stop it.
`;
