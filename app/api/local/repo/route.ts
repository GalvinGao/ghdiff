import { useLogger, withEvlog } from '@/lib/logger';
import {
  isLocalGitEnabled,
  LocalGitError,
  localGitRoot,
  readLocalRepoInfo,
  resolveRepoPath,
} from '@/lib/server/localGit';

// Describes a local repository so the local-review form can offer real branch
// names and sensible defaults instead of asking the user to type refs blind.

export const dynamic = 'force-dynamic';

export const GET = withEvlog(async (request: Request): Promise<Response> => {
  const log = useLogger();
  const url = new URL(request.url);
  const input = url.searchParams.get('repo');

  if (input == null || input.trim().length === 0) {
    return Response.json(
      { enabled: isLocalGitEnabled(), root: localGitRoot() },
      { headers: { 'cache-control': 'no-store' } }
    );
  }

  try {
    const repoPath = await resolveRepoPath(input);
    const info = await readLocalRepoInfo(repoPath);
    log.set({ outcome: 'ok', repoPath });
    return Response.json(
      { enabled: true, root: localGitRoot(), info },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    const status = error instanceof LocalGitError ? error.status : 500;
    log.set({ outcome: 'error', status });
    return Response.json(
      {
        enabled: isLocalGitEnabled(),
        root: localGitRoot(),
        error:
          error instanceof Error
            ? error.message
            : 'Could not read that repository.',
      },
      { status, headers: { 'cache-control': 'no-store' } }
    );
  }
});
