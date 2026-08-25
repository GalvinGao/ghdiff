import { createFileRoute } from '@tanstack/react-router';

import { requestLog, withEvlog } from '@/lib/logger';
import { type PullDetails, toPullDetails } from '@/lib/pullDetails';
import {
  GitHubError,
  type GitHubPullRequest,
  githubJson,
  readGitHubToken,
} from '@/lib/server/github';

// One pull request's own details, for the card behind its title in the header.
// The diff route does not carry them: it streams a patch, and the reviewer opens
// the card long after the diff has arrived, if at all.

const OWNER_REPO_PATTERN = /^[A-Za-z0-9._-]+$/;

const getPull = withEvlog(
  async ({ request }: { request: Request }): Promise<Response> => {
    const log = requestLog();
    const params = new URL(request.url).searchParams;
    const owner = params.get('owner');
    const repo = params.get('repo');
    const number = Number(params.get('number'));
    if (
      owner == null ||
      repo == null ||
      !OWNER_REPO_PATTERN.test(owner) ||
      !OWNER_REPO_PATTERN.test(repo) ||
      !Number.isInteger(number) ||
      number <= 0
    ) {
      log.set({ outcome: 'invalid-target' });
      return Response.json(
        { error: 'That pull request is not valid.' },
        { status: 400, headers: { 'cache-control': 'no-store' } }
      );
    }

    const token = readGitHubToken(request);
    log.set({ authenticated: token != null, owner, repo, number });

    try {
      const pull = await githubJson<GitHubPullRequest>(
        `/repos/${owner}/${repo}/pulls/${number}`,
        token
      );
      const details: PullDetails = toPullDetails(owner, repo, pull);
      log.set({ outcome: 'ok', state: details.state });
      return Response.json(details, {
        headers: { 'cache-control': 'no-store' },
      });
    } catch (error) {
      const status = error instanceof GitHubError ? error.status : 502;
      log.set({ outcome: 'error', status });
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Could not read that pull request.',
        },
        { status, headers: { 'cache-control': 'no-store' } }
      );
    }
  }
);

export const Route = createFileRoute('/api/github/pull')({
  server: { handlers: { GET: getPull } },
});
