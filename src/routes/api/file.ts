import { createFileRoute } from '@tanstack/react-router';

import { FILE_TOO_LARGE, MAX_FILE_BYTES } from '@/lib/diffHydration';
import { requestLog, toLoggable, withEvlog } from '@/lib/logger';
import {
  newSideRef,
  type ReviewTarget,
  reviewTargetFromQuery,
  reviewTargetKey,
} from '@/lib/reviewTarget';
import {
  encodeRefForPath,
  GitHubError,
  githubRaw,
  githubWebRaw,
  readGitHubToken,
} from '@/lib/server/github';

// One file's contents, as text/plain, at the commit the target's diff ends on.
//
// This is what lets a reviewer expand the unmodified lines around a hunk: a
// patch carries three lines of context and the viewer needs the whole file.
// `/api/archive` is the primary way those files travel — the whole new side in
// one request — and this route is the fallback the browser reaches for when
// the archive failed, ran past a cap, or never held the path.
// It is a route and not an RPC procedure for the same reason `/api/diff` is
// one — the body is a file, the Worker hands GitHub's own stream straight to
// the browser, and a JSON envelope would make it read all of it into memory
// and escape it first.
//
// Only the new side is fetched. `src/lib/diffHydration.ts` rebuilds the old
// side from this file and the patch, which costs no request and cannot
// disagree with the diff on screen.
//
// Where it is fetched from turns on the token, and only on the token. A
// caller with none has sixty REST requests an hour and needs them for the
// comments and the pull request list, so its file comes from the host behind
// github.com's own **Raw** links, which costs none of them. A caller with a
// token has five thousand and a private repository to reach, so its file comes
// from the API, which is the only one of the two that can answer for one.

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' },
  });
}

/**
 * A path arrives from a browser and goes into the URL of whichever source
 * answers. `encodeRefForPath` escapes each segment but leaves a dot alone, so
 * a `..` segment would climb out of the endpoint: the segments are checked
 * here rather than trusted there.
 */
function isReadablePath(path: string): boolean {
  if (path.length === 0 || path.length > 1024) return false;
  return path
    .split('/')
    .every(
      (segment) => segment.length > 0 && segment !== '.' && segment !== '..'
    );
}

/**
 * How many bytes GitHub says the file is, or nothing when it did not say
 * anything this route can act on. `content-length` counts the bytes on the
 * wire, so a compressed answer states a figure far under the file's own size
 * and is no answer at all; a chunked one states nothing. Either way the
 * browser counts what it decodes, and that is the guard that always holds.
 */
function statedSize(response: Response): number | undefined {
  if (response.headers.get('content-encoding') != null) return undefined;
  const header = response.headers.get('content-length');
  if (header == null) return undefined;
  const size = Number(header);
  return Number.isFinite(size) ? size : undefined;
}

function gitHubFile(
  target: ReviewTarget,
  ref: string,
  path: string,
  token: string | undefined
): Promise<Response> {
  if (token == null) {
    return githubWebRaw(target.owner, target.repo, ref, path);
  }
  return githubRaw(
    `/repos/${target.owner}/${target.repo}/contents/${encodeRefForPath(
      path
    )}?ref=${encodeURIComponent(ref)}`,
    token
  );
}

const getFile = withEvlog(
  async ({ request }: { request: Request }): Promise<Response> => {
    const log = requestLog();
    const params = new URL(request.url).searchParams;
    const target = reviewTargetFromQuery(params);
    if (target == null) {
      log.set({ outcome: 'invalid-target' });
      return textResponse('That review target is not valid.', 400);
    }
    const path = params.get('path');
    if (path == null || !isReadablePath(path)) {
      log.set({ outcome: 'invalid-path' });
      return textResponse('That file path is not valid.', 400);
    }
    const ref = newSideRef(target);
    log.set({
      target: reviewTargetKey(target),
      targetKind: target.kind,
      path,
      ref,
    });

    const token = readGitHubToken(request);
    log.set({
      authenticated: token != null,
      source: token == null ? 'web-raw' : 'api-contents',
    });
    try {
      const response = await gitHubFile(target, ref, path, token);
      const size = statedSize(response);
      if (size != null && size > MAX_FILE_BYTES) {
        // Nothing here reads the body, so it is cancelled rather than left for
        // the runtime to hold open behind a response nobody wanted.
        void response.body?.cancel();
        log.set({ outcome: 'too-large', size });
        return textResponse(FILE_TOO_LARGE, 413);
      }
      log.set({ outcome: 'ok', size });
      return new Response(response.body, {
        status: 200,
        headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' },
      });
    } catch (error) {
      if (error instanceof GitHubError) {
        log.set({ outcome: 'error', status: error.status });
        return textResponse(error.message, error.status);
      }
      log.error(toLoggable(error), { step: 'load-file' });
      return textResponse('Could not load that file.', 500);
    }
  }
);

export const Route = createFileRoute('/api/file')({
  server: { handlers: { GET: getFile } },
});
