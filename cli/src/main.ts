import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  describeReviewTarget,
  type LocalDiffTarget,
} from '../../src/lib/reviewTarget.ts';
import { DEFAULT_PORT, helpText, parseArgs, VERSION } from './args.ts';
import { TOKEN_PARAM } from './guards.ts';
import { listUntracked, resolveRepositoryRoot, verifyRange } from './repo.ts';
import { startLocalServer } from './server.ts';

// `ghdiff` — the ghdiff review surface, over a diff that is on this machine.
//
// One command, one process, one browser tab. The process stays alive until
// Ctrl-C, and that is load-bearing rather than lazy: hunk expansion fetches a
// whole file per press, so a server that exited after handing over the patch
// would break the expand control on every file in the diff.

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.kind === 'help') {
    process.stdout.write(`${await helpText()}\n`);
    return 0;
  }
  if (parsed.kind === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (parsed.kind === 'error') {
    process.stderr.write(`${parsed.message}\n`);
    return 2;
  }

  const { range, open, port } = parsed.run;
  const root = await resolveRepositoryRoot(process.cwd());
  await verifyRange(root, range);

  const target: LocalDiffTarget = { kind: 'local-diff', root, range };
  // 256 bits from the platform's own CSPRNG, minted for this run and kept
  // nowhere. See `cli/src/guards.ts` for what it is and is not for.
  const token = randomBytes(32).toString('base64url');
  const webRoot = await realpath(
    join(dirname(fileURLToPath(import.meta.url)), '../web')
  );

  // The port is the origin the browser files this review's comments, viewed
  // marks and display settings under, so it is fixed unless the developer names
  // one. A port nobody asked for may give way to a free one; a port somebody
  // asked for may not.
  const server = await startLocalServer({
    target,
    token,
    webRoot,
    port: port ?? DEFAULT_PORT,
    allowFallback: port == null,
  });
  const url = `http://127.0.0.1:${server.port}/?${TOKEN_PARAM}=${token}`;

  process.stdout.write(`${describeReviewTarget(target)}\n`);
  process.stdout.write(`${url}\n`);
  if (server.fellBack) {
    // Saying which port is the small half of this. The half that matters is
    // what the reviewer would otherwise work out for themselves after losing
    // an afternoon of notes: the browser files them per address.
    process.stdout.write(
      `Port ${DEFAULT_PORT} is busy, so this run is on ${server.port}. Your browser keeps comments and viewed marks per address, so notes from earlier runs are not in this tab.\n`
    );
  }
  if (range.mode === 'worktree') {
    // `git diff HEAD` cannot see a file git is not tracking, so each one is
    // diffed on its own and they land at the end of the patch. Saying how many
    // is what tells a developer why the diff is longer than they expected, and
    // where the switch that shortens it is.
    const untracked = await listUntracked(root);
    if (untracked.length > 0) {
      const one = untracked.length === 1;
      process.stdout.write(
        `${untracked.length} untracked ${one ? 'file is' : 'files are'} in this diff. Hide ${
          one ? 'it' : 'them'
        } from the display menu.\n`
      );
    }
  }
  process.stdout.write('Ctrl-C to stop.\n');

  if (open) openBrowser(url);

  await stopped(server.close);
  return 0;
}

/**
 * Resolves when the developer asks for the process to end, after the socket has
 * been closed. Both signals, because a terminal sends INT and a supervisor
 * sends TERM, and a server left listening would hold the port.
 */
function stopped(close: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const end = async () => {
      await close();
      // The terminal is holding a `^C` on the line the prompt is about to be
      // written over.
      process.stdout.write('\n');
      resolve();
    };
    process.once('SIGINT', () => void end());
    process.once('SIGTERM', () => void end());
  });
}

/**
 * Hands the address to whatever the platform opens addresses with, detached and
 * with its output thrown away.
 *
 * Nothing waits for it and nothing reports its failure: the URL has already
 * been printed, so a machine with no browser — a container, a remote shell over
 * ssh — loses nothing that was not already on screen.
 */
function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : process.platform === 'win32'
        ? { file: 'cmd', args: ['/c', 'start', '', url] }
        : { file: 'xdg-open', args: [url] };
  try {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Nothing to say. The address is on screen either way.
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  // `LaunchFailure` and `GitFailure` both extend Error, and their whole point
  // is that `message` is already the sentence to print — so there is one branch
  // here and not three.
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
