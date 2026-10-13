// The deployments a GitLab project has on record for the commits under review,
// for the header's deployments menu — the GitLab half of `../github/
// deployments.ts`, read into the same shape.
//
// GitLab files a deployment under the job that ran it and the environment it
// went to, and its REST list has no filter by commit. So the newest page of the
// project's deployments is read once and narrowed to the commits that matter
// here: a merge request's newest commits, or a commit's or a range's head. A
// build of an older push is still a link worth offering, the way it is on
// GitHub.

import {
  type DeploymentsData,
  readHeadChecks,
  toDeployment,
} from '@/lib/deployments';
import type { GitLabTarget } from '@/lib/reviewTarget';
import type { ForgeCredential } from '@/lib/server/forges/types';
import { GitHubError } from '@/lib/server/github/client';
import { gitLabJson } from '@/lib/server/gitlab/api';

/** The commits of a merge request asked about, as on the GitHub side. */
const MR_COMMITS = 20;
/**
 * How many of the project's newest deployments are read before narrowing.
 * Room for a busy project's last day of builds, and one request.
 */
const DEPLOYMENTS_PAGE = 100;

interface PipelineSource {
  status?: string | null;
}

interface DeploymentRow {
  id: number;
  sha: string;
  ref?: string | null;
  status?: string | null;
  created_at: string;
  updated_at?: string | null;
  user?: { username?: string | null; avatar_url?: string | null } | null;
  environment?: { name?: string | null; external_url?: string | null } | null;
  deployable?: { web_url?: string | null } | null;
}

/**
 * GitLab's pipeline states, as the check rollup's words `readHeadChecks`
 * reads. Everything still on its way is pending; a pipeline nobody will run
 * — skipped, manual, canceled — says nothing about whether to wait.
 */
function rollupOf(pipeline: PipelineSource | null | undefined) {
  switch (pipeline?.status) {
    case 'created':
    case 'waiting_for_resource':
    case 'preparing':
    case 'pending':
    case 'running':
    case 'scheduled':
      return 'PENDING';
    case 'success':
      return 'SUCCESS';
    case 'failed':
      return 'FAILURE';
    default:
      return undefined;
  }
}

/** A deployment's state, in the status words `toDeployment` reads. */
function statusOf(status: string | null | undefined): string | undefined {
  switch (status) {
    case 'created':
    case 'running':
    case 'blocked':
      return 'in_progress';
    case 'success':
      return 'success';
    case 'failed':
      return 'failure';
    case 'canceled':
    case 'skipped':
      return 'inactive';
    default:
      return undefined;
  }
}

/**
 * The refusal a reviewer cannot fix from a diff: a project whose deployments
 * this credential may not list. It reads as nothing deployed, the way the
 * GitHub side reads a missing permission.
 */
function isPermissionRefusal(error: unknown): boolean {
  return (
    error instanceof GitHubError &&
    (error.status === 401 || error.status === 403 || error.status === 404)
  );
}

export async function readGitLabDeployments(
  target: GitLabTarget,
  cred: ForgeCredential
): Promise<DeploymentsData & { outcome: string }> {
  const project = `/projects/${encodeURIComponent(target.project)}`;
  let headSha: string | undefined;
  let headBranch: string | undefined;
  let pipeline: PipelineSource | null | undefined;
  let shas: string[];
  if (target.kind === 'gitlab-mr') {
    const path = `${project}/merge_requests/${target.number}`;
    const [mr, commits] = await Promise.all([
      gitLabJson<{
        sha?: string | null;
        source_branch?: string | null;
        head_pipeline?: PipelineSource | null;
      }>(target.host, path, cred),
      gitLabJson<{ id: string }[]>(
        target.host,
        `${path}/commits?per_page=${MR_COMMITS}`,
        cred
      ),
    ]);
    headSha = mr.sha ?? undefined;
    headBranch = mr.source_branch ?? undefined;
    pipeline = mr.head_pipeline;
    shas = commits.map((commit) => commit.id);
  } else {
    const rev = target.kind === 'gitlab-commit' ? target.sha : target.head;
    const commit = await gitLabJson<{
      id?: string;
      last_pipeline?: PipelineSource | null;
    }>(
      target.host,
      `${project}/repository/commits/${encodeURIComponent(rev)}`,
      cred
    );
    if (commit.id == null) return { deployments: [], outcome: 'no-commit' };
    headSha = commit.id;
    pipeline = commit.last_pipeline;
    shas = [commit.id];
  }
  if (headSha != null && !shas.includes(headSha)) shas.push(headSha);

  let rows: DeploymentRow[];
  try {
    rows = await gitLabJson<DeploymentRow[]>(
      target.host,
      `${project}/deployments?order_by=updated_at&sort=desc&per_page=${DEPLOYMENTS_PAGE}`,
      cred
    );
  } catch (error) {
    if (isPermissionRefusal(error)) {
      return { headSha, deployments: [], outcome: 'no-permission' };
    }
    throw error;
  }

  const wanted = new Set(shas);
  const now = Date.now();
  const deployments = rows.flatMap((row) => {
    if (!wanted.has(row.sha)) return [];
    const read = toDeployment(
      {
        id: row.id,
        environment: row.environment?.name,
        sha: row.sha,
        branch: row.ref ?? headBranch,
        createdAt: row.created_at,
        creatorLogin: row.user?.username,
        creatorAvatarUrl: row.user?.avatar_url,
        statusState: statusOf(row.status),
        environmentUrl: row.environment?.external_url,
        logUrl: row.deployable?.web_url,
      },
      now
    );
    return read == null ? [] : [read];
  });
  return {
    headSha,
    headChecks: readHeadChecks(rollupOf(pipeline)),
    deployments,
    outcome: 'ok',
  };
}
