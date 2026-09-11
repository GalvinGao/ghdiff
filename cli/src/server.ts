import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, realpath, readFile, rm, stat } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve as resolvePath, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { FILE_TOO_LARGE, MAX_FILE_BYTES } from '../../src/lib/fileLimit.ts';
import { isReadablePath } from '../../src/lib/filePath.ts';
import {
  CODE_FONT_SCRIPT,
  COLOR_MODE_SCRIPT,
} from '../../src/lib/prePaintScripts.ts';
import {
  type LocalDiffTarget,
  reviewTargetFromQuery,
  reviewTargetQuery,
} from '../../src/lib/reviewTarget.ts';
import {
  git,
  GitFailure,
  type GitStep,
  streamGit,
  streamGitSteps,
} from './git.ts';
import {
  diffArgs,
  newSideSource,
  rangeShowsUntracked,
  showArgs,
  untrackedDiffArgs,
  untrackedStageArgs,
} from './gitRange.ts';
import { checkApiRequest, TOKEN_HEADER } from './guards.ts';
import { LaunchFailure, listUntracked } from './repo.ts';

// The other host for the ghdiff frontend.
//
// The browser cannot tell this apart from the Worker, because the contract
// between ghdiff and a diff source is exactly two things: one unified patch,
// and one whole file. `git diff` emits the first and `git show` emits the
// second, so the viewer, the file tree, hunk expansion, the whitespace marks,
// the cron hints, the path filter and the fragment grammar all arrive here
// working and unmodified.
//
// What this server does *not* have is the other half of the app. There is no
// GitHub call in it, no session, no RPC — the client it serves knows that and
// draws none of the controls that would need one. See `cli/web/main.tsx`.

const TEXT = {
  'cache-control': 'no-store',
  'content-type': 'text/plain; charset=utf-8',
} as const;

/** Assets are content-hashed by the build, so they can be held forever. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export interface LocalServerOptions {
  /** The repository, pinned. Nothing in a request may change it. */
  target: LocalDiffTarget;
  /** This run's token, which every `/api` request must present. */
  token: string;
  /** Where `vite build` left the client. */
  webRoot: string;
}

/**
 * The options, plus the document, which is read at launch: it cannot change
 * while this process runs, and a missing build then fails in the terminal
 * rather than as a blank tab.
 */
interface ServerContext extends LocalServerOptions {
  document: string;
}

export interface RunningServer {
  port: number;
  /** True when the preferred port was taken and the kernel picked this one. */
  fellBack: boolean;
  close(): Promise<void>;
}

/**
 * Binds the socket, preferring one port and saying whether it got it.
 *
 * The preferred port is the storage origin as much as it is an address — see
 * `DEFAULT_PORT` — so falling back is not free and the caller has to be told.
 * A port the developer named is never fallen back from: they named it, and
 * serving somewhere else without a word is the one answer nobody asked for.
 */
export async function startLocalServer(
  options: LocalServerOptions & { port: number; allowFallback: boolean }
): Promise<RunningServer> {
  const context: ServerContext = {
    ...options,
    document: await readDocument(options.webRoot),
  };
  const server = createServer();
  // Read off the socket on every request, because the `Host` check compares
  // against the port actually bound and a fallback changes it.
  server.on('request', (request, response) => {
    void handle(request, response, context, boundPort(server)).catch(
      (error) => {
        fail(response, error);
      }
    );
  });

  try {
    await listen(server, options.port);
    return {
      port: boundPort(server),
      fellBack: false,
      close: () => closeServer(server),
    };
  } catch (error) {
    if (!options.allowFallback || !isAddressInUse(error)) {
      throw addressInUseFailure(error, options.port);
    }
  }
  await listen(server, 0);
  return {
    port: boundPort(server),
    fellBack: true,
    close: () => closeServer(server),
  };
}

/** The document this server fills in and serves, read once, before the bind. */
async function readDocument(webRoot: string): Promise<string> {
  try {
    return await readFile(join(webRoot, 'index.html'), 'utf8');
  } catch {
    throw new LaunchFailure(
      `This ghdiff install is missing its web build at ${webRoot}. Reinstall it, or run pnpm build:cli if you are working on ghdiff itself.`
    );
  }
}

/**
 * 127.0.0.1 and nothing else. Never 0.0.0.0, and there is no flag that offers
 * it: this server reads a developer's source code, and a socket on every
 * interface would offer it to the network they are on.
 */
function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

function boundPort(server: Server): number {
  const address = server.address();
  return typeof address === 'object' && address != null ? address.port : 0;
}

function isAddressInUse(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'EADDRINUSE';
}

/** git's own sentence is not the one to print for a port somebody chose. */
function addressInUseFailure(error: unknown, port: number): unknown {
  if (!isAddressInUse(error)) return error;
  return new LaunchFailure(
    `Port ${port} is already in use. Stop what is on it, or run ghdiff with a different --port.`
  );
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: ServerContext,
  port: number
): Promise<void> {
  // No CORS header is sent anywhere in this file, so a preflight has nothing
  // to approve and a cross-origin request with the token header never happens.
  // Answering OPTIONS with a refusal is that rule said out loud.
  if (request.method === 'OPTIONS') {
    text(response, 405, 'This server answers its own page and nothing else.');
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    text(response, 405, 'This server reads. It answers GET.');
    return;
  }

  const url = new URL(request.url ?? '/', 'http://127.0.0.1');

  if (url.pathname === '/api/diff' || url.pathname === '/api/file') {
    const refusal = checkApiRequest({
      host: request.headers.host,
      port,
      token: headerValue(request, TOKEN_HEADER),
      expectedToken: options.token,
    });
    if (!refusal.allowed) {
      text(response, refusal.status, refusal.message);
      return;
    }
    // The query says which diff the client thinks it is reading. It is checked
    // against the one this process was started for and then thrown away: the
    // repository and the range come from the launch and from nowhere else, so
    // no request can widen what this server reads.
    if (!describesPinnedTarget(url.searchParams, options.target)) {
      text(
        response,
        400,
        'This ghdiff is serving a different repository. Run the command in the one you want to read.'
      );
      return;
    }
    await (url.pathname === '/api/diff'
      ? serveDiff(response, options)
      : serveFile(response, url, options));
    return;
  }

  await serveAsset(request, response, url, options);
}

/**
 * Whether the query names the diff this process was started for.
 *
 * This is not what keeps the server safe — pinning is — but it is what turns a
 * tab left open from an earlier run into one clear sentence instead of a
 * patch from the wrong repository.
 */
function describesPinnedTarget(
  params: URLSearchParams,
  pinned: LocalDiffTarget
): boolean {
  const asked = reviewTargetFromQuery(params);
  if (asked == null || asked.kind !== 'local-diff') return false;
  // A target's query is its identity, and `reviewTarget.ts` owns both
  // directions of it, so a fifth range mode is covered the day it is added.
  return (
    reviewTargetQuery(asked).toString() === reviewTargetQuery(pinned).toString()
  );
}

/**
 * The patch: the range's own diff, and then the files git is not tracking.
 *
 * `git diff HEAD` cannot see an untracked file, so they are staged into an
 * index of their own and diffed in one go — see `untrackedStageArgs` for why
 * that writes nothing into the repository. Both answers stream into the same
 * body. Which files those were reaches the browser through the document rather
 * than through this route; see `serveDocument`.
 *
 * The list is read here and not at launch, and nothing caps it: a cap would be
 * this command deciding which of a developer's own files are worth looking at.
 */
async function serveDiff(
  response: ServerResponse,
  options: ServerContext
): Promise<void> {
  const { range, root } = options.target;
  const steps: GitStep[] = [{ args: diffArgs(range), required: true }];
  // Where the temporary index and the empty blob live, for this one response.
  const scratch = rangeShowsUntracked(range)
    ? await untrackedScratch(root)
    : undefined;
  if (scratch != null) steps.push(...scratch.steps);

  try {
    await streamGitSteps({
      steps,
      cwd: root,
      response,
      headers: { ...TEXT },
      describeFailure: (stderr) => ({
        status: 500,
        message:
          stderr.length > 0
            ? stderr
            : 'git could not produce that diff. Check the revision and try again.',
      }),
    });
  } finally {
    if (scratch != null) await scratch.discard();
  }
}

/**
 * The two untracked steps and the way to clean up after them, or nothing when
 * there is no untracked file — two spawns that would stage and print nothing.
 */
async function untrackedScratch(
  root: string
): Promise<{ steps: GitStep[]; discard(): Promise<void> } | undefined> {
  const paths = await listUntracked(root);
  if (paths.length === 0) return undefined;

  const dir = await mkdtemp(join(tmpdir(), 'ghdiff-'));
  const objects = join(dir, 'objects');
  await mkdir(objects);
  // A path with no file at it yet, so git makes the empty index the diff needs.
  const env = {
    GIT_INDEX_FILE: join(dir, 'index'),
    GIT_OBJECT_DIRECTORY: objects,
  };
  return {
    steps: [
      { args: untrackedStageArgs(), env, stdin: `${paths.join('\0')}\0` },
      { args: untrackedDiffArgs(), env },
    ],
    discard: async () => {
      await rm(dir, { force: true, recursive: true });
    },
  };
}

/**
 * One whole file, for the unmodified lines around a hunk.
 *
 * The size is asked for first, in its own call, so a file over the cap is
 * turned away with a status rather than truncated into a body the browser
 * would then try to reverse-apply the patch onto. `git cat-file -s` answers
 * for an object and `stat` answers for the working tree, and both are cheap.
 */
async function serveFile(
  response: ServerResponse,
  url: URL,
  options: ServerContext
): Promise<void> {
  const path = url.searchParams.get('path');
  if (path == null || !isReadablePath(path)) {
    text(response, 400, 'That file path is not valid.');
    return;
  }

  const source = newSideSource(options.target.range);
  if (source.from === 'object') {
    const size = await git(
      ['cat-file', '-s', `${source.rev}:${path}`],
      options.target.root
    );
    if (!size.ok) {
      text(response, 404, `git has no ${path} at that revision.`);
      return;
    }
    if (Number(size.stdout.trim()) > MAX_FILE_BYTES) {
      text(response, 413, FILE_TOO_LARGE);
      return;
    }
    await streamGit({
      args: showArgs(source.rev, path),
      cwd: options.target.root,
      response,
      headers: { ...TEXT },
      describeFailure: () => ({
        status: 404,
        message: `git has no ${path} at that revision.`,
      }),
    });
    return;
  }

  // The working tree, which is the one source that is a path on a disk. Every
  // other range reads an object, where git resolves the name against the
  // repository's own database and nothing outside it can be addressed at all.
  const full = await containedPath(options.target.root, path);
  if (full == null) {
    text(response, 404, `There is no ${path} in the working tree.`);
    return;
  }
  const stats = await stat(full).catch(() => undefined);
  if (stats == null || !stats.isFile()) {
    text(response, 404, `There is no ${path} in the working tree.`);
    return;
  }
  if (stats.size > MAX_FILE_BYTES) {
    text(response, 413, FILE_TOO_LARGE);
    return;
  }
  response.writeHead(200, TEXT);
  await pipeline(createReadStream(full), response);
}

/**
 * The absolute path of a file inside the repository, or nothing.
 *
 * `isReadablePath` has already refused a `..` segment, which is what a path
 * would climb out with. This is the other half: a symlink inside the
 * repository pointing outside it resolves to somewhere else entirely, and
 * `realpath` is the only thing that can see that. The root was realpathed at
 * launch, so the two sides of the comparison are both resolved.
 */
async function containedPath(
  root: string,
  path: string
): Promise<string | undefined> {
  const candidate = resolvePath(root, path);
  const real = await realpath(candidate).catch(() => undefined);
  if (real == null) return undefined;
  return real === root || real.startsWith(root + sep) ? real : undefined;
}

async function serveAsset(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: ServerContext
): Promise<void> {
  // Every path that is not an asset is the page: the client is a single
  // document with a router in it, and a fragment or a stray path must not be a
  // 404 in a tab the command itself opened.
  const requested =
    url.pathname === '/' ? '/index.html' : decodePath(url.pathname);
  const file =
    requested == null
      ? undefined
      : await containedPath(options.webRoot, requested.slice(1));

  if (file == null || !(await isFile(file)) || file.endsWith('index.html')) {
    await serveDocument(response, options);
    return;
  }

  response.writeHead(200, {
    'cache-control': IMMUTABLE,
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  await pipeline(createReadStream(file), response);
}

/**
 * The document, with three scripts put into its head.
 *
 * Two of them are the app's own pre-paint scripts, read out of
 * `src/lib/prePaintScripts.ts` — the same text `__root.tsx` renders on the
 * hosted side, so a reviewer's colour scheme and code font settle here exactly
 * as they do there. The third is what this host has and the other does not: the
 * repository, the range, and the files git is not tracking, none of which the
 * client can ask for in a request it cannot make until it knows them.
 *
 * The untracked paths are here rather than on `/api/diff` because nothing
 * bounds how many there are. A response header carrying them would be exact —
 * it would be the same listing the patch was built from, where this is a second
 * one taken a moment earlier — but a repository with an unignored
 * `node_modules` would put megabytes into a header, and a document has no such
 * limit. What the millisecond between the two listings costs is one file:
 * written in that window, it is in the patch as an ordinary addition and cannot
 * be hidden until the page is loaded again.
 *
 * The token is not among them. It arrives once in the address the command
 * opened, and nothing this server writes into the document carries it. What
 * stops a stale one is `checkApiRequest`, which compares against the token this
 * process minted; `cli/src/guards.ts` states that rule and the three beside it.
 */
async function serveDocument(
  response: ServerResponse,
  options: ServerContext
): Promise<void> {
  const { range, root } = options.target;
  const untracked = rangeShowsUntracked(range) ? await listUntracked(root) : [];
  const head = [
    `<script>${COLOR_MODE_SCRIPT}</script>`,
    `<script>${CODE_FONT_SCRIPT}</script>`,
    `<script>window.__GHDIFF_LOCAL__=${embed({ target: options.target, untracked })};</script>`,
  ].join('');
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': 'text/html; charset=utf-8',
    // This document is the whole app, and it embeds nothing from anywhere
    // else. Saying so costs one header and closes the frame this page could
    // otherwise be put in.
    'x-frame-options': 'DENY',
  });
  response.end(options.document.replace('</head>', `${head}</head>`));
}

/**
 * One JSON value as a JavaScript string literal the document can hold. `<` is
 * escaped because a repository path is free to contain the four characters
 * that would otherwise end the script element it is written into.
 */
function embed(value: unknown): string {
  return JSON.stringify(JSON.stringify(value)).replace(/</g, '\\u003c');
}

/** A percent-encoded asset path, or nothing when it is not one. */
function decodePath(pathname: string): string | undefined {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
}

async function isFile(path: string): Promise<boolean> {
  const stats = await stat(path).catch(() => undefined);
  return stats?.isFile() === true;
}

function headerValue(
  request: IncomingMessage,
  name: string
): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function text(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, TEXT);
  response.end(body);
}

function fail(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  if (error instanceof GitFailure) {
    text(response, error.status, error.message);
    return;
  }
  text(
    response,
    500,
    error instanceof Error ? error.message : 'Something went wrong.'
  );
}
