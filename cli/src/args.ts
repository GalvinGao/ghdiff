import {
  type ArgsDef,
  defineCommand,
  parseArgs as parseDeclaredArgs,
  renderUsage,
} from 'citty';

import {
  parseCompareRange,
  type LocalDiffRange,
} from '../../src/lib/reviewTarget.ts';

// What the command was asked for, read off `process.argv` and nothing else.
//
// The tokenizing is citty's: `command` below declares every option once, and
// `parseDeclaredArgs` turns an argument vector into an object against that
// declaration — `--port=4000` and `--port 4000`, `--no-open`, `-h`, and
// everything after `--`. What is left here is the part a parser cannot know,
// which is what this command means by what it was handed.
//
// Still pure, and still tested as such: everything below is a decision about
// text, and the git repository is not consulted. A range that parses is not a
// range that exists — `main..typo` parses fine and `git rev-parse` is what
// turns it down, with git's own sentence.

/** Written into the bundle by the build, so `--version` and the usage answer. */
declare const __GHDIFF_VERSION__: string;

export const VERSION =
  typeof __GHDIFF_VERSION__ === 'string' ? __GHDIFF_VERSION__ : '0.0.0-dev';

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

/**
 * The command, declared once.
 *
 * This is the only statement of what `ghdiff` takes: the parser reads it, and
 * so does the usage `--help` prints, so an option cannot come to be accepted
 * and undocumented or documented and refused.
 *
 * `--cached` is its own entry rather than an alias of `--staged`, because
 * citty renders an alias with a single dash — `-cached, --staged` — and a
 * spelling nobody can type is worse than a second line. git's own name for the
 * index is worth a line of its own anyway: a developer who types
 * `git diff --cached` all day should not have to remember which of the two this
 * command wanted.
 */
export const COMMAND_ARGS = {
  revision: {
    type: 'positional',
    required: false,
    valueHint: 'revision',
    description:
      'A branch, a tag or a commit, or a range as base..head. Left out, the diff is your uncommitted work.',
  },
  staged: {
    type: 'boolean',
    description: 'What is about to land, rather than everything uncommitted.',
  },
  cached: {
    type: 'boolean',
    description: 'The same thing, spelled git’s own way.',
  },
  port: {
    type: 'string',
    valueHint: 'n',
    description: `Bind this port instead of ${DEFAULT_PORT}.`,
  },
  open: {
    type: 'boolean',
    default: true,
    description: 'Open the address in your browser.',
    negativeDescription: 'Print the address and leave the browser alone.',
  },
  help: { type: 'boolean', alias: ['h'], description: 'This.' },
  version: {
    type: 'boolean',
    alias: ['v', 'V'],
    description: 'The command’s own version.',
  },
} satisfies ArgsDef;

export const command = defineCommand({
  meta: {
    name: 'ghdiff',
    version: VERSION,
    description: 'Read a local git diff in the ghdiff review surface',
  },
  args: COMMAND_ARGS,
});

/**
 * Every name a parsed object may carry, taken from the declaration above rather
 * than written out, so a new option cannot be read as an unknown one.
 *
 * citty parses loosely — it asks `node:util.parseArgs` for `strict: false`, so
 * an option this command does not have arrives as a key instead of an error.
 * That is the one thing the declaration cannot answer on its own, and this set
 * is what answers it: anything outside it was a typo.
 */
const DECLARED = new Set<string>([
  '_',
  ...Object.entries(COMMAND_ARGS).flatMap(([name, arg]) => [
    name,
    ...aliasesOf(arg),
  ]),
]);

/** An arg's aliases, however the declaration spelled them. */
function aliasesOf(arg: ArgsDef[string]): string[] {
  const alias = (arg as { alias?: string | string[] }).alias;
  if (alias == null) return [];
  return Array.isArray(alias) ? alias : [alias];
}

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
  const args = parseDeclaredArgs<typeof COMMAND_ARGS>([...argv], COMMAND_ARGS);

  // Before anything else, because both are answers about the command rather
  // than about a diff, and neither cares what else was typed beside it.
  if (args.help === true) return { kind: 'help' };
  if (args.version === true) return { kind: 'version' };

  const unknown = Object.keys(args).find((name) => !DECLARED.has(name));
  if (unknown != null) {
    return {
      kind: 'error',
      message: `${asTyped(argv, unknown)} is not an option this command has. Run ghdiff --help to see the ones it does.`,
    };
  }

  const staged = args.staged === true || args.cached === true;
  const open = args.open !== false;
  // Absent is nothing at all; `--port` with no value after it is the empty
  // string, which is a port this command was asked for and cannot use.
  const asked = typeof args.port === 'string' ? args.port : undefined;
  const port = asked == null ? undefined : parsePort(asked);
  if (asked != null && port == null) {
    return {
      kind: 'error',
      message: `--port takes a number from 1 to 65535. Got ${describe(asked)}.`,
    };
  }

  if (args._.length > 1) {
    return {
      kind: 'error',
      message:
        'Name one revision or one range. Two refs go together as base..head.',
    };
  }
  const revision = args._[0];

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

/**
 * What `--help` prints: citty's own usage, rendered from the declaration above,
 * and then the part it cannot know.
 *
 * The table is what a developer opens this for, and none of its three columns
 * follows from an option — `ghdiff main` being `git diff main...HEAD` is a
 * decision this command made. The three paragraphs under it are each a thing a
 * reviewer finds out too late otherwise: where the untracked files went, why
 * changing the port loses their notes, and what the server does to the
 * repository, which is nothing.
 */
export async function helpText(): Promise<string> {
  return `${await renderUsage(command)}\n${NOTES}`;
}

const NOTES = `EXAMPLES

  ghdiff                  uncommitted work         git diff HEAD
  ghdiff --staged         what is about to land    git diff --cached
  ghdiff main             this branch on its base  git diff main...HEAD
  ghdiff main..feature    any two revisions        git diff main...feature

Files you have not added yet are in the first of those, at the end of the diff.
The display menu has a switch that takes them back off.

Comments you leave, and the files you mark read, are kept by your browser under
this address, which is why the port is always ${DEFAULT_PORT} unless you say so:
change it and you will not find your earlier notes.

The server listens on 127.0.0.1 only, serves the one repository the command was
run in, and reads. It never commits, never changes your index, and never checks
anything out: your .git directory is left exactly as it was. Nothing leaves the
machine. Press Ctrl-C to stop it.
`;

function badRevision(revision: string): string {
  return `${describe(
    revision
  )} is not a revision. Name a branch, a tag or a commit, or a range as base..head.`;
}

/**
 * The unknown option as the developer wrote it, so the message names what they
 * typed. A parsed object holds the name and not the spelling, and `--frobnicate`
 * is a more useful thing to be told about than `frobnicate`.
 */
function asTyped(argv: readonly string[], name: string): string {
  return (
    argv.find(
      (arg) =>
        arg === `--${name}` ||
        arg === `-${name}` ||
        arg === `--no-${name}` ||
        arg.startsWith(`--${name}=`)
    ) ?? `--${name}`
  );
}

function parsePort(value: string): number | undefined {
  if (!/^\d{1,5}$/.test(value)) return undefined;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : undefined;
}

function describe(value: string | undefined): string {
  return value == null || value.length === 0 ? 'nothing' : `"${value}"`;
}
