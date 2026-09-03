import { createFileRoute } from '@tanstack/react-router';

import { requestLog, toLoggable, withEvlog } from '@/lib/logger';
import { pullCommitDiffTarget } from '@/lib/pullCommits';
import {
  type ReviewTarget,
  reviewTargetFromQuery,
  reviewTargetKey,
} from '@/lib/reviewTarget';
import {
  encodeRefForPath,
  GitHubError,
  githubDiff,
  githubJson,
  githubWebDiff,
  resolveGitHubToken,
} from '@/lib/server/github';
import {
  commitFilesFetch,
  compareFilesFetch,
  describeSynthesisGaps,
  fetchFilePages,
  pullFilesFetch,
  synthesizePatch,
} from '@/lib/server/githubPatch';
import { readPullCommits, requirePullCommit } from '@/lib/server/pullCommits';
import { recordServe } from '@/lib/server/servedCount';

// Returns the unified diff for one review target as text/plain.
//
// A target is tried three ways, cheapest and most complete first. See the note
// above githubWebDiff for why the web host leads and the API follows.

/** Set when the fallback could not carry the whole diff. */
const SYNTHESIS_NOTICE_HEADER = 'x-ghdiff-notice';

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' },
  });
}

function webPath(target: ReviewTarget): string {
  switch (target.kind) {
    case 'github-pull':
      return `/${target.owner}/${target.repo}/pull/${target.number}`;
    case 'github-commit':
      return `/${target.owner}/${target.repo}/commit/${target.sha}`;
    case 'github-compare':
      return `/${target.owner}/${target.repo}/compare/${encodeRefForPath(
        target.base
      )}...${encodeRefForPath(target.head)}`;
  }
}

function apiPath(target: ReviewTarget): string {
  switch (target.kind) {
    case 'github-pull':
      return `/repos/${target.owner}/${target.repo}/pulls/${target.number}`;
    case 'github-commit':
      return `/repos/${target.owner}/${target.repo}/commits/${target.sha}`;
    case 'github-compare':
      return `/repos/${target.owner}/${target.repo}/compare/${encodeRefForPath(
        target.base
      )}...${encodeRefForPath(target.head)}`;
  }
}

function filesFetch(target: ReviewTarget) {
  switch (target.kind) {
    case 'github-pull':
      return pullFilesFetch(target.owner, target.repo, target.number);
    case 'github-commit':
      return commitFilesFetch(target.owner, target.repo, target.sha);
    case 'github-compare':
      return compareFilesFetch(
        target.owner,
        target.repo,
        target.base,
        target.head
      );
  }
}

function streamed(response: Response, notice?: string): Response {
  const headers: Record<string, string> = {
    'cache-control': 'no-store',
    'content-type': 'text/plain',
  };
  if (notice != null) {
    headers[SYNTHESIS_NOTICE_HEADER] = notice;
  }
  return new Response(response.body, { status: 200, headers });
}

interface AttemptFailure {
  source: string;
  status: number;
  message: string;
}

const getDiff = withEvlog(
  async ({ request }: { request: Request }): Promise<Response> => {
    const log = requestLog();
    const params = new URL(request.url).searchParams;
    const target = reviewTargetFromQuery(params);
    if (target == null) {
      log.set({ outcome: 'invalid-target' });
      return textResponse('That review target is not valid.', 400);
    }
    log.set({ target: reviewTargetKey(target), targetKind: target.kind });

    try {
      const response = await gitHubResponse(target, request, log);
      // One serve, counted. `gitHubResponse` returns only when a source
      // answered, so a 404 or a spent quota is not a serve. The write itself
      // happens after this response has gone.
      recordServe();
      return response;
    } catch (error) {
      if (error instanceof GitHubError) {
        log.set({ outcome: 'error', status: error.status });
        return textResponse(error.message, error.status);
      }
      log.error(toLoggable(error), { step: 'load-diff' });
      return textResponse('Could not load that diff.', 500);
    }
  }
);

export const Route = createFileRoute('/api/diff')({
  server: { handlers: { GET: getDiff } },
});

async function gitHubResponse(
  target: ReviewTarget,
  request: Request,
  log: ReturnType<typeof requestLog>
): Promise<Response> {
  const { token } = await resolveGitHubToken(request);
  log.set({ authenticated: token != null });
  if (target.kind === 'github-pull' && target.commitSha != null) {
    const commits = await readPullCommits(
      (path) => githubJson(path, token),
      target
    );
    try {
      target = pullCommitDiffTarget(
        target,
        requirePullCommit(commits, target.commitSha)
      );
    } catch (error) {
      throw new GitHubError(400, (error as Error).message);
    }
  }
  const failures: AttemptFailure[] = [];

  // 1. The web host. No file or line cap, and it streams.
  try {
    const response = await githubWebDiff(webPath(target), token);
    log.set({ outcome: 'ok', source: 'web-diff' });
    return streamed(response);
  } catch (error) {
    failures.push(describeFailure('web-diff', error));
  }

  // 2. The API's diff media type. Caps a pull request at 300 files and 20000
  //    lines, but it accepts a token on every repository.
  try {
    const response = await githubDiff(apiPath(target), token);
    log.set({ outcome: 'ok', source: 'api-diff' });
    return streamed(response);
  } catch (error) {
    failures.push(describeFailure('api-diff', error));
  }

  // 3. The JSON file list, stitched back into a patch. This is the path that
  //    survives the 406 above, at the cost of GitHub's own file-count limit.
  try {
    const fetched = await fetchFilePages(
      (path) => githubJson(path, token),
      filesFetch(target)
    );
    const result = synthesizePatch(fetched.files);
    const notice = describeSynthesisGaps(result, fetched.truncated);
    log.set({
      outcome: 'ok',
      source: 'files-api',
      fileCount: result.fileCount,
      filesWithoutPatch: result.filesWithoutPatch.length,
      truncated: fetched.truncated,
    });
    return new Response(result.patch, {
      status: 200,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'text/plain',
        ...(notice == null ? {} : { [SYNTHESIS_NOTICE_HEADER]: notice }),
      },
    });
  } catch (error) {
    failures.push(describeFailure('files-api', error));
  }

  log.set({ outcome: 'error', failures: failures.map((f) => f.source) });
  throw bestFailure(failures);
}

function describeFailure(source: string, error: unknown): AttemptFailure {
  if (error instanceof GitHubError) {
    return { source, status: error.status, message: error.message };
  }
  return {
    source,
    status: 502,
    message:
      error instanceof Error ? error.message : 'That request to GitHub failed.',
  };
}

/**
 * Reports the most informative failure. The API speaks in full sentences and
 * knows whether the repository exists, so its message beats the web host's,
 * whose 404 covers both "absent" and "not permitted".
 */
function bestFailure(failures: readonly AttemptFailure[]): GitHubError {
  const api = failures.find((failure) => failure.source === 'api-diff');
  const chosen = api ?? failures[0];
  if (chosen == null) {
    return new GitHubError(502, 'Could not load that diff.');
  }
  return new GitHubError(chosen.status, chosen.message);
}
