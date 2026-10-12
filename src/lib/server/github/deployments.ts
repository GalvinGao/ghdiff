// The deployments GitHub has on record for the commits under review, read
// for the header's deployments menu.
//
// A caller with a token reads GraphQL: a pull request's newest commits with
// their deployments and the status of each, in one query. A caller with none
// reads REST, which GraphQL refuses an anonymous caller for — and REST keeps a
// deployment's status apart from the deployment, so each one costs a request
// out of sixty an hour, and only the newest of each environment is read.

import type { Octokit } from '@octokit/core';

import {
  type DeploymentsData,
  readHeadChecks,
  toDeployment,
} from '@/lib/deployments';
import type { GitHubTarget } from '@/lib/reviewTarget';
import {
  DEPLOYMENTS_OF_COMMIT_QUERY,
  DEPLOYMENTS_OF_PULL_QUERY,
} from '@/lib/server/forges/github.gql';
import type { DeployedCommitFragment } from '@/lib/server/forges/gqlgen/github/graphql';
import { GitHubError } from '@/lib/server/github/client';
import { gql } from '@/lib/server/github/octokit';

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
 * How many statuses a caller with no token may cost. The newest deployment of
 * each environment is the one worth a request, and three environments is most
 * repositories.
 */
const ANONYMOUS_STATUS_READS = 3;

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
      /not accessible by (integration|personal access token)/i.test(
        error.message
      ))
  );
}

export async function readDeployments(
  octokit: Octokit,
  target: GitHubTarget,
  authenticated: boolean
): Promise<DeploymentsData & { outcome: string }> {
  try {
    return authenticated
      ? await readWithGraphQL(octokit, target)
      : await readAnonymously(octokit, target);
  } catch (error) {
    if (isPermissionRefusal(error)) {
      return { deployments: [], outcome: 'no-permission' };
    }
    throw error;
  }
}

async function readWithGraphQL(
  octokit: Octokit,
  target: GitHubTarget
): Promise<DeploymentsData & { outcome: string }> {
  const now = Date.now();
  const { owner, repo } = target;
  if (target.kind === 'github-pull') {
    const data = await gql(octokit, DEPLOYMENTS_OF_PULL_QUERY, {
      owner,
      repo,
      number: target.number,
      commits: PULL_COMMITS,
      deployments: DEPLOYMENTS_PER_COMMIT,
    });
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

  const data = await gql(octokit, DEPLOYMENTS_OF_COMMIT_QUERY, {
    owner,
    repo,
    expression: headExpression(target),
    deployments: DEPLOYMENTS_PER_COMMIT,
  });
  const commit = data.repository?.object;
  // A compare range typed across two forks names its head `owner:branch`,
  // which no expression resolves. That range has nothing to deploy.
  if (!isDeployedCommit(commit)) {
    return { deployments: [], outcome: 'no-commit' };
  }
  return {
    headSha: commit.oid,
    headChecks: readHeadChecks(commit.statusCheckRollup?.state),
    deployments: readCommit(commit, undefined, now),
    outcome: 'ok',
  };
}

/** True for an object the expression resolved to a commit. */
function isDeployedCommit(
  object: object | null | undefined
): object is DeployedCommitFragment {
  return object != null && 'oid' in object && typeof object.oid === 'string';
}

function readCommit(
  commit: DeployedCommitFragment,
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

function headExpression(target: GitHubTarget): string {
  switch (target.kind) {
    case 'github-pull':
      return `refs/pull/${target.number}/head`;
    case 'github-commit':
      return target.sha;
    case 'github-compare':
      return target.head;
  }
}

/**
 * The head's deployments, read the way a caller with no token can: resolve the
 * head, list what was deployed from it, and read one status per environment.
 * The browser asks for this once and never polls it.
 */
async function readAnonymously(
  octokit: Octokit,
  target: GitHubTarget
): Promise<DeploymentsData & { outcome: string }> {
  const { owner, repo } = target;
  let headSha: string;
  let headBranch: string | undefined;
  if (target.kind === 'github-pull') {
    const { data: pull } = await octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      { owner, repo, pull_number: target.number }
    );
    headSha = pull.head.sha;
    headBranch = pull.head.ref;
  } else {
    const { data: commit } = await octokit.request(
      'GET /repos/{owner}/{repo}/commits/{ref}',
      { owner, repo, ref: headExpression(target) }
    );
    headSha = commit.sha;
  }

  const { data: listed } = await octokit.request(
    'GET /repos/{owner}/{repo}/deployments',
    { owner, repo, sha: headSha, per_page: DEPLOYMENTS_PER_COMMIT }
  );
  const newestPerEnvironment = new Map<string, (typeof listed)[number]>();
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
      const {
        data: [status],
      } = await octokit.request(
        'GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses',
        { owner, repo, deployment_id: Number(deployment.id), per_page: 1 }
      );
      return toDeployment(
        {
          id: Number(deployment.id),
          environment: deployment.environment,
          description: deployment.description,
          sha: deployment.sha,
          // REST names the ref as it was given, which is a sha as often as a
          // branch. Only a branch makes an alias.
          branch:
            deployment.ref !== deployment.sha ? deployment.ref : headBranch,
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
