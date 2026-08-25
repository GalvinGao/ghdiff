import { requestLog, toLoggable, withEvlog } from '@/lib/logger';
import { reviewTargetFromQuery, reviewTargetKey } from '@/lib/reviewTarget';
import {
  GitHubError,
  encodeRefForPath,
  githubDiff,
  readGitHubToken,
} from '@/lib/server/github';
import {
  LocalGitError,
  readLocalDiff,
  resolveRepoPath,
} from '@/lib/server/localGit';

// Returns the unified diff for one review target as text/plain. GitHub bodies
// stream straight through; a local `git diff` is buffered because execFile
// gives one string.

export const dynamic = 'force-dynamic';

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' },
  });
}

export const GET = withEvlog(async (request: Request): Promise<Response> => {
  const log = requestLog();
  const params = new URL(request.url).searchParams;
  const target = reviewTargetFromQuery(params);
  if (target == null) {
    log.set({ outcome: 'invalid-target' });
    return textResponse('That review target is not valid.', 400);
  }
  log.set({ target: reviewTargetKey(target), targetKind: target.kind });

  try {
    if (target.kind === 'local') {
      const repoPath = await resolveRepoPath(target.repoPath);
      const patch = await readLocalDiff({
        repoPath,
        base: target.base,
        head: target.head,
      });
      log.set({ outcome: 'ok', source: 'local', bytes: patch.length });
      return textResponse(patch, 200);
    }

    const token = readGitHubToken(request);
    log.set({ source: 'github', authenticated: token != null });
    const response = await githubDiff(githubDiffPath(target), token);
    log.set({ outcome: 'ok' });
    return new Response(response.body, {
      status: 200,
      headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' },
    });
  } catch (error) {
    if (error instanceof GitHubError || error instanceof LocalGitError) {
      log.set({ outcome: 'error', status: error.status });
      return textResponse(error.message, error.status);
    }
    log.error(toLoggable(error), { step: 'load-diff' });
    return textResponse('Could not load that diff.', 500);
  }
});

function githubDiffPath(
  target: Exclude<ReturnType<typeof reviewTargetFromQuery>, undefined>
): string {
  switch (target.kind) {
    case 'github-pull':
      return `/repos/${target.owner}/${target.repo}/pulls/${target.number}`;
    case 'github-commit':
      return `/repos/${target.owner}/${target.repo}/commits/${target.sha}`;
    case 'github-compare':
      return `/repos/${target.owner}/${target.repo}/compare/${encodeRefForPath(
        target.base
      )}...${encodeRefForPath(target.head)}`;
    case 'local':
      throw new Error('A local target has no GitHub path.');
  }
}
