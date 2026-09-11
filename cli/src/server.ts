import { serve, type ServerType } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type MiddlewareHandler } from 'hono';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, realpath, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath, sep } from 'node:path';
import { Readable } from 'node:stream';

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
import { git, GitFailure, type GitStep, gitStream } from './git.ts';
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
// Hono is what answers those two routes, which makes the resemblance more than
// a resemblance: the Worker is a `fetch` handler over web `Request` and
// `Response`, and so is this. A patch is a `ReadableStream` on both hosts, and
// `gitStream` is the only thing between `git diff` and the same body GitHub's
// own answer arrives as.
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
  /**
   * The port actually bound, read off the socket rather than off the option:
   * the `Host` check compares against it, and a fallback changes it.
   */
  port(): number;
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
  let bound: ServerType | undefined;
  const app = buildApp({
    ...options,
    document: await readDocument(options.webRoot),
    port: () => boundPort(bound),
  });

  try {
    bound = await listen(app, options.port);
  } catch (error) {
    if (!options.allowFallback || !isAddressInUse(error)) {
      throw addressInUseFailure(error, options.port);
    }
    bound = await listen(app, 0);
    return {
      port: boundPort(bound),
      fellBack: true,
      close: () => close(bound),
    };
  }
  return { port: boundPort(bound), fellBack: false, close: () => close(bound) };
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
function listen(app: Hono, port: number): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    const server = serve(
      { fetch: app.fetch, hostname: '127.0.0.1', port },
      () => {
        server.removeListener('error', onError);
        resolve(server);
      }
    );
    server.once('error', onError);
  });
}

function boundPort(server: ServerType | undefined): number {
  const address = server?.address();
  return typeof address === 'object' && address != null ? address.port : 0;
}

function isAddressInUse(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'EADDRINUSE';
}

/** Node's own sentence is not the one to print for a port somebody chose. */
function addressInUseFailure(error: unknown, port: number): unknown {
  if (!isAddressInUse(error)) return error;
  return new LaunchFailure(
    `Port ${port} is already in use. Stop what is on it, or run ghdiff with a different --port.`
  );
}

function close(server: ServerType | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (server == null) {
      resolve();
      return;
    }
    // Only `http.Server` has it, and that is what `serve` binds here; the
    // type is the union with HTTP/2, which this command never asks for.
    (server as { closeAllConnections?: () => void }).closeAllConnections?.();
    server.close(() => resolve());
  });
}

/**
 * Everything this server answers, in the order a request meets it.
 *
 * Reading down this function is the whole of what is reachable: one guard over
 * every request, a second over `/api`, the two routes behind it, the built
 * client, and the document for every path that is none of those.
 */
function buildApp(context: ServerContext): Hono {
  const app = new Hono();

  app.use('*', methodGuard);
  app.use('/api/*', apiGuard(context));

  app.on(['GET', 'HEAD'], '/api/diff', () => serveDiff(context));
  app.on(['GET', 'HEAD'], '/api/file', (c) =>
    serveFile(c.req.query('path'), context)
  );

  app.use('*', assets(context.webRoot));
  // Every path that is not an asset is the page: the client is a single
  // document with a router in it, and a fragment or a stray path must not be a
  // 404 in a tab the command itself opened.
  app.all('*', () => serveDocument(context));

  app.onError((error) =>
    error instanceof GitFailure
      ? plain(error.message, error.status)
      : plain(
          error instanceof Error ? error.message : 'Something went wrong.',
          500
        )
  );

  return app;
}

/**
 * This server reads. No CORS header is sent anywhere in this file, so a
 * preflight has nothing to approve and a cross-origin request carrying the
 * token header never happens; answering OPTIONS with a refusal is that rule
 * said out loud.
 */
const methodGuard: MiddlewareHandler = async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return plain('This server answers its own page and nothing else.', 405);
  }
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    return plain('This server reads. It answers GET.', 405);
  }
  await next();
  return;
};

/**
 * Everything that stands between `/api` and another page in another tab: the
 * `Host`, the run's own token, and the repository this process was started for.
 * `cli/src/guards.ts` states the first two and why each is there.
 */
function apiGuard(context: ServerContext): MiddlewareHandler {
  return async (c, next) => {
    const refusal = checkApiRequest({
      host: c.req.header('host'),
      port: context.port(),
      token: c.req.header(TOKEN_HEADER),
      expectedToken: context.token,
    });
    if (!refusal.allowed) return plain(refusal.message, refusal.status);
    // The query says which diff the client thinks it is reading. It is checked
    // against the one this process was started for and then thrown away: the
    // repository and the range come from the launch and from nowhere else, so
    // no request can widen what this server reads.
    const asked = new URL(c.req.url).searchParams;
    if (!describesPinnedTarget(asked, context.target)) {
      return plain(
        'This ghdiff is serving a different repository. Run the command in the one you want to read.',
        400
      );
    }
    await next();
    return;
  };
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
 *
 * The temporary index is discarded by `gitStream` and not here, because this
 * function returns at the first byte of the *first* step and the two untracked
 * steps run after that.
 */
async function serveDiff(context: ServerContext): Promise<Response> {
  const { range, root } = context.target;
  const steps: GitStep[] = [{ args: diffArgs(range), required: true }];
  // Where the temporary index and the empty blob live, for this one response.
  const scratch = rangeShowsUntracked(range)
    ? await untrackedScratch(root)
    : undefined;
  if (scratch != null) steps.push(...scratch.steps);

  const body = await gitStream({
    steps,
    cwd: root,
    cleanup: scratch?.discard,
    describeFailure: (stderr) => ({
      status: 500,
      message:
        stderr.length > 0
          ? stderr
          : 'git could not produce that diff. Check the revision and try again.',
    }),
  });
  return new Response(body, { headers: { ...TEXT } });
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
  path: string | undefined,
  context: ServerContext
): Promise<Response> {
  if (path == null || !isReadablePath(path)) {
    return plain('That file path is not valid.', 400);
  }

  const { range, root } = context.target;
  const source = newSideSource(range);
  if (source.from === 'object') {
    const size = await git(['cat-file', '-s', `${source.rev}:${path}`], root);
    if (!size.ok) return plain(`git has no ${path} at that revision.`, 404);
    if (Number(size.stdout.trim()) > MAX_FILE_BYTES) {
      return plain(FILE_TOO_LARGE, 413);
    }
    const body = await gitStream({
      steps: [{ args: showArgs(source.rev, path), required: true }],
      cwd: root,
      describeFailure: () => ({
        status: 404,
        message: `git has no ${path} at that revision.`,
      }),
    });
    return new Response(body, { headers: { ...TEXT } });
  }

  // The working tree, which is the one source that is a path on a disk. Every
  // other range reads an object, where git resolves the name against the
  // repository's own database and nothing outside it can be addressed at all.
  const full = await containedFile(root, path);
  if (full == null) {
    return plain(`There is no ${path} in the working tree.`, 404);
  }
  if (full.size > MAX_FILE_BYTES) return plain(FILE_TOO_LARGE, 413);
  return new Response(webStream(createReadStream(full.path)), {
    headers: { ...TEXT },
  });
}

/**
 * A file inside a directory, and its size, or nothing.
 *
 * `resolvePath` normalizes away a `..` segment, which is what a path would
 * climb out with, and `realpath` is the other half: a symlink inside the
 * directory pointing outside it resolves somewhere else entirely, and nothing
 * but `realpath` can see that. Both roots this is called with were realpathed
 * at launch, so the two sides of the comparison are both resolved.
 */
async function containedFile(
  root: string,
  path: string
): Promise<{ path: string; size: number } | undefined> {
  const real = await realpath(resolvePath(root, path)).catch(() => undefined);
  if (real == null) return undefined;
  if (real !== root && !real.startsWith(root + sep)) return undefined;
  const stats = await stat(real).catch(() => undefined);
  return stats?.isFile() === true
    ? { path: real, size: stats.size }
    : undefined;
}

/**
 * The built client, from the directory this command was installed into.
 *
 * The lookup is this command's, because the containment test is: `serveStatic`
 * refuses a `..` segment before it touches the disk, but nothing in `vite build`
 * being a symlink today is not a rule, and a rule that holds only while that
 * stays true fails quietly. What the library is left with is everything after
 * the path resolves — the type off the extension, `HEAD`, `Last-Modified`, a
 * byte range — which is why it is handed a `path` rather than a `root`.
 *
 * A request that names no file falls through to the document, and so does `/`
 * and any `index.html`: the file on disk is the same page with none of the
 * three scripts `serveDocument` puts into its head.
 *
 * The cache header is free. Every other name under here is content-hashed by
 * the build, so a file that exists at a name is the file that name will always
 * mean.
 */
function assets(webRoot: string): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;
    if (path === '/' || path.endsWith('/index.html')) return next();
    const requested = decodePath(path);
    const file =
      requested == null
        ? undefined
        : await containedFile(webRoot, requested.replace(/^\/+/, ''));
    if (file == null) return next();
    c.header('cache-control', IMMUTABLE);
    return serveStatic({ path: file.path })(c, next);
  };
}

/** A percent-encoded asset path, or nothing when it is not one. */
function decodePath(pathname: string): string | undefined {
  try {
    const decoded = decodeURIComponent(pathname);
    return decoded.includes('\0') ? undefined : decoded;
  } catch {
    return undefined;
  }
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
async function serveDocument(context: ServerContext): Promise<Response> {
  const { range, root } = context.target;
  const untracked = rangeShowsUntracked(range) ? await listUntracked(root) : [];
  const head = [
    `<script>${COLOR_MODE_SCRIPT}</script>`,
    `<script>${CODE_FONT_SCRIPT}</script>`,
    `<script>window.__GHDIFF_LOCAL__=${embed({ target: context.target, untracked })};</script>`,
  ].join('');
  return new Response(context.document.replace('</head>', `${head}</head>`), {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
      // This document is the whole app, and it embeds nothing from anywhere
      // else. Saying so costs one header and closes the frame this page
      // could otherwise be put in.
      'x-frame-options': 'DENY',
    },
  });
}

/**
 * One JSON value as a JavaScript string literal the document can hold. `<` is
 * escaped because a repository path is free to contain the four characters
 * that would otherwise end the script element it is written into.
 */
function embed(value: unknown): string {
  return JSON.stringify(JSON.stringify(value)).replace(/</g, '\\u003c');
}

/**
 * One whole file off the disk, as a body a `Response` takes.
 *
 * Nothing holds it: node-server reads this a chunk at a time and stops reading
 * when the socket stops draining, which is the same backpressure `gitStream`
 * gets for a patch.
 */
function webStream(stream: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

function plain(body: string, status: number): Response {
  return new Response(body, { status, headers: { ...TEXT } });
}
