import { createFileRoute } from '@tanstack/react-router';

import { requestLog, withEvlog } from '@/lib/logger';
import {
  dedupeWatchedRepos,
  formatWatchedRepo,
  type OpenPullsData,
  parseWatchedRepo,
  type PullSummary,
  type WatchedRepo,
} from '@/lib/pulls';
import { normalizePullStatus, type PullStatusSource } from '@/lib/pullStatus';
import {
  GitHubError,
  type GitHubPullRequest,
  type GitHubUser,
  githubGraphQL,
  githubJson,
  readGitHubToken,
} from '@/lib/server/github';

// Open pull requests for the watched repositories. The browser owns the watch
// list, so it sends the list on each request and the server keeps no state.
//
// The rows come back flat. The left bar groups them by repository, author, and
// stack, and the home page filters them by repository first, so grouping on the
// server would only have to be undone on the client.

const MAX_WATCHED_REPOS = 25;
const MAX_PULLS_PER_REPO = 50;

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
      return json({ pulls: [], failures: [] });
    }

    const token = readGitHubToken(request);
    log.set({ authenticated: token != null });

    // The viewer login decides which pull requests are self review. Without a
    // token there is no viewer, so every author reads as somebody else.
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
        try {
          const result =
            token == null
              ? await readOpenPullsRest(repo, token)
              : await readOpenPullsGraphQL(repo, token);
          pulls.push(...result);
        } catch (error) {
          failures.push({
            repo: formatWatchedRepo(repo),
            message:
              error instanceof GitHubError
                ? error.message
                : 'Could not read that repository.',
          });
        }
      })
    );

    log.set({ pullCount: pulls.length, failureCount: failures.length, viewer });
    return json({ viewer, pulls, failures });
  }
);

function json(data: OpenPullsData): Response {
  return Response.json(data, { headers: { 'cache-control': 'no-store' } });
}

// `reviews(last: 1, states: [CHANGES_REQUESTED])` is the one review that
// matters here: the newest request for changes, so the author's newest commit
// can be compared against it.
const OPEN_PULLS_QUERY = `
query($owner:String!,$repo:String!,$first:Int!){
  repository(owner:$owner,name:$repo){
    pullRequests(states:OPEN,first:$first,orderBy:{field:UPDATED_AT,direction:DESC}){
      nodes{
        number title url isDraft updatedAt
        headRefName baseRefName headRefOid reviewDecision
        author{ login avatarUrl }
        commits(last:1){nodes{commit{oid committedDate statusCheckRollup{state}}}}
        reviews(last:1,states:[CHANGES_REQUESTED]){nodes{submittedAt}}
      }
    }
  }
}`;

interface GraphQLPullNode extends PullStatusSource {
  number?: number | null;
  title?: string | null;
  url?: string | null;
  isDraft?: boolean | null;
  updatedAt?: string | null;
  headRefName?: string | null;
  baseRefName?: string | null;
  author?: { login?: string | null; avatarUrl?: string | null } | null;
}

interface OpenPullsQueryData {
  repository?: {
    pullRequests?: { nodes?: (GraphQLPullNode | null)[] | null } | null;
  } | null;
}

/** The list with its review decision and its check rollup. Needs a token. */
async function readOpenPullsGraphQL(
  repo: WatchedRepo,
  token: string
): Promise<PullSummary[]> {
  const data = await githubGraphQL<OpenPullsQueryData>(
    OPEN_PULLS_QUERY,
    { owner: repo.owner, repo: repo.repo, first: MAX_PULLS_PER_REPO },
    token
  );
  // A token that cannot see the repository gets a 200 with a null repository.
  if (data.repository == null) {
    throw new GitHubError(404, 'Not Found');
  }

  const pulls: PullSummary[] = [];
  for (const node of data.repository.pullRequests?.nodes ?? []) {
    if (node == null || typeof node.number !== 'number') continue;
    pulls.push({
      owner: repo.owner,
      repo: repo.repo,
      number: node.number,
      title: node.title ?? '',
      author: node.author?.login ?? 'unknown',
      authorAvatarUrl: node.author?.avatarUrl ?? undefined,
      // The query asks for open pull requests only, so the lifecycle is either
      // open or draft.
      state: node.isDraft === true ? 'draft' : 'open',
      htmlUrl: node.url ?? '',
      updatedAt: node.updatedAt ?? '',
      headRef: node.headRefName ?? '',
      baseRef: node.baseRefName ?? '',
      status: normalizePullStatus(node),
    });
  }
  return pulls;
}

/** The same list without the two status axes, for a reviewer with no token. */
async function readOpenPullsRest(
  repo: WatchedRepo,
  token: string | undefined
): Promise<PullSummary[]> {
  const result = await githubJson<GitHubPullRequest[]>(
    `/repos/${repo.owner}/${repo.repo}/pulls?state=open&sort=updated&direction=desc&per_page=${MAX_PULLS_PER_REPO}`,
    token
  );
  return result.map((pull) => ({
    owner: repo.owner,
    repo: repo.repo,
    number: pull.number,
    title: pull.title,
    author: pull.user?.login ?? 'unknown',
    authorAvatarUrl: pull.user?.avatar_url,
    state: pull.draft === true ? 'draft' : 'open',
    htmlUrl: pull.html_url,
    updatedAt: pull.updated_at,
    headRef: pull.head.ref,
    baseRef: pull.base.ref,
  }));
}

export const Route = createFileRoute('/api/github/pulls')({
  server: {
    handlers: {
      GET: getPulls,
    },
  },
});
