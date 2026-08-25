import { createFileRoute } from '@tanstack/react-router';

import { requestLog, withEvlog } from '@/lib/logger';
import {
  dedupeWatchedRepos,
  formatWatchedRepo,
  groupPulls,
  parseWatchedRepo,
  pullState,
  type PullSummary,
  type PullSwitcherData,
} from '@/lib/pullSwitcher';
import {
  GitHubError,
  type GitHubPullRequest,
  type GitHubUser,
  githubJson,
  readGitHubToken,
} from '@/lib/server/github';

// Open pull requests for the watched repositories, already grouped for the
// switcher. The browser owns the watch list, so it sends the list on each
// request and the server keeps no state.

const MAX_WATCHED_REPOS = 25;

const getPulls = withEvlog(
  async ({ request }: { request: Request }): Promise<Response> => {
    const log = requestLog();
    const raw = new URL(request.url).searchParams.get('repos') ?? '';
    const repos = dedupeWatchedRepos(
      raw
        .split(',')
        .map((entry) => parseWatchedRepo(entry))
        .filter((entry): entry is NonNullable<typeof entry> => entry != null)
    ).slice(0, MAX_WATCHED_REPOS);

    log.set({ repoCount: repos.length });
    if (repos.length === 0) {
      return Response.json(
        { groups: [], failures: [] } satisfies PullSwitcherData,
        {
          headers: { 'cache-control': 'no-store' },
        }
      );
    }

    const token = readGitHubToken(request);
    log.set({ authenticated: token != null });

    // The viewer login decides which pull requests are self review. Without a
    // token there is no viewer, so every pull request lands under "Others".
    const viewer =
      token == null
        ? undefined
        : await githubJson<GitHubUser>('/user', token)
            .then((user) => user.login)
            .catch(() => undefined);

    const pulls: PullSummary[] = [];
    const failures: { repo: string; message: string }[] = [];

    await Promise.all(
      repos.map(async (repo) => {
        const label = formatWatchedRepo(repo);
        try {
          const result = await githubJson<GitHubPullRequest[]>(
            `/repos/${repo.owner}/${repo.repo}/pulls?state=open&sort=updated&direction=desc&per_page=50`,
            token
          );
          for (const pull of result) {
            pulls.push({
              owner: repo.owner,
              repo: repo.repo,
              number: pull.number,
              title: pull.title,
              author: pull.user?.login ?? 'unknown',
              authorAvatarUrl: pull.user?.avatar_url,
              state: pullState(pull),
              htmlUrl: pull.html_url,
              updatedAt: pull.updated_at,
              headRef: pull.head.ref,
              baseRef: pull.base.ref,
            });
          }
        } catch (error) {
          failures.push({
            repo: label,
            message:
              error instanceof GitHubError
                ? error.message
                : 'Could not read that repository.',
          });
        }
      })
    );

    log.set({ pullCount: pulls.length, failureCount: failures.length, viewer });
    const data: PullSwitcherData = {
      viewer,
      groups: groupPulls(pulls, viewer),
      failures,
    };
    return Response.json(data, { headers: { 'cache-control': 'no-store' } });
  }
);

export const Route = createFileRoute('/api/github/pulls')({
  server: { handlers: { GET: getPulls } },
});
