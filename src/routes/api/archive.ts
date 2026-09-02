import { createFileRoute } from '@tanstack/react-router';

import { requestLog, toLoggable, withEvlog } from '@/lib/logger';
import {
  newSideRef,
  reviewTargetFromQuery,
  reviewTargetKey,
} from '@/lib/reviewTarget';
import {
  GitHubError,
  githubArchive,
  readGitHubToken,
} from '@/lib/server/github';

// The whole new side of a review, as one tar.gz of the head commit's worktree.
//
// Expanding a hunk's unmodified lines needs whole files, and fetching them one
// by one priced a review by its file count: three hundred changed files were
// three hundred requests against an anonymous quota of sixty an hour. An
// archive is one request for all of them — and for the whole repository too,
// which is the browser's problem, not this route's: the browser decompresses
// the stream, keeps the paths the diff names, and stops the download the
// moment it has them or the moment it has read too much. This route only
// stands between the browser and a host that allows no cross-origin caller,
// the same job `/api/diff` does for the web diff host, and it buffers nothing.
//
// The old side of every file still costs no request at all:
// `src/lib/diffHydration.ts` rebuilds it from the new side and the patch.

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' },
  });
}

const getArchive = withEvlog(
  async ({ request }: { request: Request }): Promise<Response> => {
    const log = requestLog();
    const params = new URL(request.url).searchParams;
    const target = reviewTargetFromQuery(params);
    if (target == null) {
      log.set({ outcome: 'invalid-target' });
      return textResponse('That review target is not valid.', 400);
    }
    const ref = newSideRef(target);
    log.set({
      target: reviewTargetKey(target),
      targetKind: target.kind,
      ref,
    });

    const token = readGitHubToken(request);
    log.set({
      authenticated: token != null,
      source: token == null ? 'codeload' : 'api-tarball',
    });
    try {
      const response = await githubArchive(
        target.owner,
        target.repo,
        ref,
        token
      );
      log.set({ outcome: 'ok' });
      return new Response(response.body, {
        status: 200,
        headers: {
          'cache-control': 'no-store',
          'content-type': 'application/gzip',
        },
      });
    } catch (error) {
      if (error instanceof GitHubError) {
        log.set({ outcome: 'error', status: error.status });
        return textResponse(error.message, error.status);
      }
      log.error(toLoggable(error), { step: 'load-archive' });
      return textResponse('Could not load that archive.', 500);
    }
  }
);

export const Route = createFileRoute('/api/archive')({
  server: { handlers: { GET: getArchive } },
});
