import { createFileRoute } from '@tanstack/react-router';

import { requestLog, withEvlog } from '@/lib/logger';
import {
  GitHubError,
  type GitHubUser,
  githubJson,
  readGitHubToken,
} from '@/lib/server/github';

// Confirms a token works and reports who it belongs to, so the token form can
// say "signed in as <login>" instead of failing silently later.

const getViewer = withEvlog(
  async ({ request }: { request: Request }): Promise<Response> => {
    const log = requestLog();
    const token = readGitHubToken(request);
    if (token == null) {
      return Response.json(
        { viewer: null },
        { headers: { 'cache-control': 'no-store' } }
      );
    }
    try {
      const user = await githubJson<GitHubUser>('/user', token);
      log.set({ outcome: 'ok', viewer: user.login });
      return Response.json(
        {
          viewer: {
            login: user.login,
            avatarUrl: user.avatar_url,
            name: user.name,
          },
        },
        { headers: { 'cache-control': 'no-store' } }
      );
    } catch (error) {
      const status = error instanceof GitHubError ? error.status : 500;
      log.set({ outcome: 'error', status });
      return Response.json(
        {
          viewer: null,
          error: error instanceof Error ? error.message : 'Token check failed.',
        },
        { status, headers: { 'cache-control': 'no-store' } }
      );
    }
  }
);

export const Route = createFileRoute('/api/github/viewer')({
  server: { handlers: { GET: getViewer } },
});
