import {
  type DeploymentsData,
  readHeadChecks,
  toDeployment,
} from '@/lib/deployments';
import {
  encodeRefForPath,
  GitHubError,
  githubGraphQL,
  githubJson,
} from '@/lib/server/github';

/** The diff under review, less its repository: the RPC input's own shape. */
export type DeploymentTarget =
  | { kind: 'github-pull'; number: number }
  | { kind: 'github-commit'; sha: string }
  | { kind: 'github-compare'; base: string; head: string };

/**
 * How many of a pull request's commits are asked about. A build of any of them
 * is a link the menu can offer, and twenty pushes back is further than any
 * reviewer scrolls a list of previews.
 */
const PULL_COMMITS = 20;
/**
 * Deployments per commit. A commit is built once per environment, so this is
 * room for ten environments — or for the rebuilds of a few.
 */
const DEPLOYMENTS_PER_COMMIT = 10;
/**
 * How many statuses a caller with no token may cost. REST keeps a deployment's
 * status apart from the deployment, so each one is a request of its own out of
 * sixty an hour; the newest deployment of each environment is the one worth
 * one, and three environments is most repositories.
 */
const ANONYMOUS_STATUS_READS = 3;

const DEPLOYED_COMMIT = `
  fragment DeployedCommit on Commit {
    oid
    statusCheckRollup { state }
    deployments(
      first: ${DEPLOYMENTS_PER_COMMIT}
      orderBy: { field: CREATED_AT, direction: DESC }
    ) {
      nodes {
        databaseId environment description createdAt state
        creator { login avatarUrl }
        ref { name }
        latestStatus { state environmentUrl logUrl }
      }
    }
  }
`;

const PULL_QUERY = `
  query DeploymentsOfPull($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        headRefName
        headRefOid
        commits(last: ${PULL_COMMITS}) { nodes { commit { ...DeployedCommit } } }
      }
    }
  }
  ${DEPLOYED_COMMIT}
`;

const COMMIT_QUERY = `
  query DeploymentsOfCommit($owner: String!, $repo: String!, $expression: String!) {
    repository(owner: $owner, name: $repo) {
      object(expression: $expression) { ...DeployedCommit }
    }
  }
  ${DEPLOYED_COMMIT}
`;

interface DeployedCommitNode {
  oid: string;
  statusCheckRollup?: { state?: string | null } | null;
  deployments?: {
    nodes?: ({
      databaseId?: number | null;
      environment?: string | null;
      description?: string | null;
      createdAt: string;
      state?: string | null;
      creator?: { login?: string | null; avatarUrl?: string | null } | null;
      ref?: { name?: string | null } | null;
      latestStatus?: {
        state?: string | null;
        environmentUrl?: string | null;
        logUrl?: string | null;
      } | null;
    } | null)[];
  } | null;
}

interface PullQueryData {
  repository?: {
    pullRequest?: {
      headRefName?: string | null;
      headRefOid?: string | null;
      commits?: {
        nodes?: ({ commit?: DeployedCommitNode | null } | null)[];
      } | null;
    } | null;
  } | null;
}

interface CommitQueryData {
  repository?: { object?: DeployedCommitNode | null } | null;
}

/**
 * GitHub's answer when the App was never granted Deployments, or an owner has
 * not accepted it yet. It reads as "nothing deployed" rather than as a failure:
 * the header draws no menu either way, and a reviewer cannot fix a permission
 * on somebody else's installation from a diff.
 */
function isPermissionRefusal(error: unknown): boolean {
  return (
    error instanceof GitHubError &&
    (error.status === 403 ||
      /not accessible by integration/i.test(error.message))
  );
}

export async function readDeployments(
  owner: string,
  repo: string,
  target: DeploymentTarget,
  token: string | undefined
): Promise<DeploymentsData & { outcome: string }> {
  try {
    return token == null
      ? await readAnonymously(owner, repo, target)
      : await readWithGraphQL(owner, repo, target, token);
  } catch (error) {
    if (isPermissionRefusal(error)) {
      return { deployments: [], outcome: 'no-permission' };
    }
    throw error;
  }
}

async function readWithGraphQL(
  owner: string,
  repo: string,
  target: DeploymentTarget,
  token: string
): Promise<DeploymentsData & { outcome: string }> {
  const now = Date.now();
  if (target.kind === 'github-pull') {
    const data = await githubGraphQL<PullQueryData>(
      PULL_QUERY,
      { owner, repo, number: target.number },
      token
    );
    const pull = data.repository?.pullRequest;
    const commits = (pull?.commits?.nodes ?? [])
      .map((node) => node?.commit)
      .filter((commit) => commit != null);
    const headSha = pull?.headRefOid ?? commits.at(-1)?.oid;
    const head = commits.find((commit) => commit.oid === headSha);
    return {
      headSha: headSha ?? undefined,
      headChecks: readHeadChecks(head?.statusCheckRollup?.state),
      deployments: commits.flatMap((commit) =>
        readCommit(commit, pull?.headRefName ?? undefined, now)
      ),
      outcome: 'ok',
    };
  }

  const data = await githubGraphQL<CommitQueryData>(
    COMMIT_QUERY,
    { owner, repo, expression: headExpression(target) },
    token
  );
  const commit = data.repository?.object;
  // A compare range typed across two forks names its head `owner:branch`,
  // which no expression resolves. That range has nothing to deploy.
  if (commit?.oid == null) return { deployments: [], outcome: 'no-commit' };
  return {
    headSha: commit.oid,
    headChecks: readHeadChecks(commit.statusCheckRollup?.state),
    deployments: readCommit(commit, undefined, now),
    outcome: 'ok',
  };
}

function readCommit(
  commit: DeployedCommitNode,
  headBranch: string | undefined,
  now: number
) {
  return (commit.deployments?.nodes ?? []).flatMap((node) => {
    if (node?.databaseId == null) return [];
    const read = toDeployment(
      {
        id: node.databaseId,
        environment: node.environment,
        description: node.description,
        sha: commit.oid,
        // A deployment made against a sha has no ref to name, and one whose
        // branch was deleted has lost it; the pull request's head branch is the
        // branch every one of its commits was pushed to.
        branch: node.ref?.name ?? headBranch,
        createdAt: node.createdAt,
        creatorLogin: node.creator?.login,
        creatorAvatarUrl: node.creator?.avatarUrl,
        deploymentState: node.state,
        statusState: node.latestStatus?.state,
        environmentUrl: node.latestStatus?.environmentUrl,
        logUrl: node.latestStatus?.logUrl,
      },
      now
    );
    return read == null ? [] : [read];
  });
}

function headExpression(target: DeploymentTarget): string {
  switch (target.kind) {
    case 'github-pull':
      return `refs/pull/${target.number}/head`;
    case 'github-commit':
      return target.sha;
    case 'github-compare':
      return target.head;
  }
}

interface RestDeployment {
  id: number;
  sha: string;
  ref?: string;
  environment?: string;
  description?: string | null;
  created_at: string;
  creator?: { login?: string; avatar_url?: string } | null;
}

interface RestDeploymentStatus {
  state?: string;
  environment_url?: string | null;
  log_url?: string | null;
}

/**
 * The head's deployments, read the way a caller with no token can: resolve the
 * head, list what was deployed from it, and read one status per environment.
 * The browser asks for this once and never polls it.
 */
async function readAnonymously(
  owner: string,
  repo: string,
  target: DeploymentTarget
): Promise<DeploymentsData & { outcome: string }> {
  const base = `/repos/${owner}/${repo}`;
  let headSha: string;
  let headBranch: string | undefined;
  if (target.kind === 'github-pull') {
    const pull = await githubJson<{ head: { sha: string; ref: string } }>(
      `${base}/pulls/${target.number}`,
      undefined
    );
    headSha = pull.head.sha;
    headBranch = pull.head.ref;
  } else {
    const commit = await githubJson<{ sha: string }>(
      `${base}/commits/${encodeRefForPath(headExpression(target))}`,
      undefined
    );
    headSha = commit.sha;
  }

  const listed = await githubJson<RestDeployment[]>(
    `${base}/deployments?sha=${headSha}&per_page=${DEPLOYMENTS_PER_COMMIT}`,
    undefined
  );
  const newestPerEnvironment = new Map<string, RestDeployment>();
  for (const deployment of listed) {
    const environment = deployment.environment ?? 'default';
    if (!newestPerEnvironment.has(environment)) {
      newestPerEnvironment.set(environment, deployment);
    }
  }
  const chosen = [...newestPerEnvironment.values()].slice(
    0,
    ANONYMOUS_STATUS_READS
  );
  const now = Date.now();
  const deployments = await Promise.all(
    chosen.map(async (deployment) => {
      const [status] = await githubJson<RestDeploymentStatus[]>(
        `${base}/deployments/${deployment.id}/statuses?per_page=1`,
        undefined
      );
      return toDeployment(
        {
          id: deployment.id,
          environment: deployment.environment,
          description: deployment.description,
          sha: deployment.sha,
          // REST names the ref as it was given, which is a sha as often as a
          // branch. Only a branch makes an alias.
          branch:
            deployment.ref != null && deployment.ref !== deployment.sha
              ? deployment.ref
              : headBranch,
          createdAt: deployment.created_at,
          creatorLogin: deployment.creator?.login,
          creatorAvatarUrl: deployment.creator?.avatar_url,
          statusState: status?.state,
          environmentUrl: status?.environment_url,
          logUrl: status?.log_url,
        },
        now
      );
    })
  );
  return {
    headSha,
    deployments: deployments.filter((deployment) => deployment != null),
    outcome: 'anonymous',
  };
}
