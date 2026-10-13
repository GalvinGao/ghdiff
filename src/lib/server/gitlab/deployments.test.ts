import {
  GITLAB_CORP,
  mockCommitShow,
  mockDeployments,
  mockMrCommits,
  mockMrShow,
} from '@test/msw/gitlab';
import { resetMocks, server } from '@test/msw/shared';
import assert from 'node:assert/strict';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

import { readGitLabDeployments } from './deployments';
import type { GitLabTarget } from '@/lib/reviewTarget';

// The deployments a project has for the commits under review, narrowed from
// the newest page of the project's list, and the head pipeline as the check
// rollup the menu waits on.

const CRED = { token: 'oauth', scheme: 'bearer' as const };
const HEAD = 'b'.repeat(40);
const OLDER = 'c'.repeat(40);
const ELSEWHERE = 'd'.repeat(40);

const MR: GitLabTarget = {
  kind: 'gitlab-mr',
  host: GITLAB_CORP,
  project: 'team/app',
  number: 7,
};
const COMMIT: GitLabTarget = {
  kind: 'gitlab-commit',
  host: GITLAB_CORP,
  project: 'team/app',
  sha: 'bbbbbbb',
};

function deployment(id: number, sha: string, status: string) {
  return {
    id,
    sha,
    ref: 'feature',
    status,
    created_at: new Date().toISOString(),
    user: { username: 'deployer', avatar_url: null },
    environment: {
      name: `review/${id}`,
      external_url: `https://review-${id}.example.com`,
    },
    deployable: { web_url: `https://${GITLAB_CORP}/team/app/-/jobs/${id}` },
  };
}

beforeAll(() => {
  server.listen();
});

afterEach(() => {
  resetMocks();
});

afterAll(() => {
  server.close();
});

describe('readGitLabDeployments', () => {
  it('keeps the deployments of the merge request own commits', async () => {
    mockMrShow(GITLAB_CORP, {
      body: {
        sha: HEAD,
        source_branch: 'feature',
        head_pipeline: { status: 'running' },
      },
    });
    mockMrCommits(GITLAB_CORP, { body: [{ id: HEAD }, { id: OLDER }] });
    mockDeployments(GITLAB_CORP, {
      body: [
        deployment(1, HEAD, 'success'),
        deployment(2, ELSEWHERE, 'success'),
        deployment(3, OLDER, 'failed'),
        deployment(4, HEAD, 'running'),
      ],
    });

    const data = await readGitLabDeployments(MR, CRED);

    assert.equal(data.outcome, 'ok');
    assert.equal(data.headSha, HEAD);
    assert.equal(data.headChecks, 'pending');
    assert.deepEqual(
      data.deployments.map((row) => [row.id, row.state]),
      [
        [1, 'success'],
        [3, 'failure'],
        [4, 'pending'],
      ]
    );
    assert.equal(data.deployments[0]?.url, 'https://review-1.example.com/');
  });

  it('reads a commit by its own sha and pipeline', async () => {
    mockCommitShow(GITLAB_CORP, {
      body: { id: HEAD, last_pipeline: { status: 'success' } },
    });
    mockDeployments(GITLAB_CORP, { body: [deployment(1, HEAD, 'success')] });

    const data = await readGitLabDeployments(COMMIT, CRED);

    assert.equal(data.headChecks, 'success');
    assert.equal(data.deployments.length, 1);
  });

  it('reads a refused list as nothing deployed', async () => {
    mockCommitShow(GITLAB_CORP, { body: { id: HEAD } });
    mockDeployments(GITLAB_CORP, {
      status: 403,
      body: { message: '403 Forbidden' },
    });

    const data = await readGitLabDeployments(COMMIT, CRED);

    assert.equal(data.outcome, 'no-permission');
    assert.deepEqual(data.deployments, []);
  });
});
