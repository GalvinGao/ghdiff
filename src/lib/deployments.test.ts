import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type Deployment,
  type DeploymentsData,
  deploymentProvider,
  deploymentsInFlight,
  latestByEnvironment,
  pagesBranchAlias,
  readHeadChecks,
  safeDeploymentUrl,
  STALLED_AFTER_MS,
  toDeployment,
} from './deployments.ts';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const NOW = Date.parse('2026-09-30T10:00:00Z');

function deployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    id: 1,
    environment: 'preview',
    sha: HEAD,
    createdAt: '2026-09-30T09:00:00Z',
    state: 'success',
    url: 'https://26b50519.pixai-studio.pages.dev/',
    branch: 'lody/f9833855-538',
    ...overrides,
  };
}

describe('safeDeploymentUrl', () => {
  it('keeps an http or https address', () => {
    assert.equal(
      safeDeploymentUrl('https://example.com/a'),
      'https://example.com/a'
    );
    assert.equal(
      safeDeploymentUrl('http://localhost:3000'),
      'http://localhost:3000/'
    );
  });

  it('refuses every scheme that is not a web page', () => {
    assert.equal(safeDeploymentUrl('javascript:alert(1)'), undefined);
    assert.equal(safeDeploymentUrl('data:text/html,hi'), undefined);
    assert.equal(safeDeploymentUrl('not a url'), undefined);
    assert.equal(safeDeploymentUrl(''), undefined);
    assert.equal(safeDeploymentUrl(null), undefined);
  });
});

describe('toDeployment', () => {
  const source = {
    id: 7,
    environment: 'preview',
    sha: HEAD,
    createdAt: '2026-09-30T09:50:00Z',
  };

  it('reads both spellings of a state', () => {
    assert.equal(
      toDeployment({ ...source, statusState: 'SUCCESS' }, NOW)?.state,
      'success'
    );
    assert.equal(
      toDeployment({ ...source, statusState: 'in_progress' }, NOW)?.state,
      'pending'
    );
    assert.equal(
      toDeployment({ ...source, statusState: 'ERROR' }, NOW)?.state,
      'failure'
    );
    assert.equal(
      toDeployment({ ...source, statusState: 'inactive' }, NOW)?.state,
      'inactive'
    );
  });

  it('reads a deployment with no status as on its way, until it is too old', () => {
    assert.equal(toDeployment(source, NOW)?.state, 'pending');
    const old = new Date(NOW - STALLED_AFTER_MS - 1).toISOString();
    assert.equal(
      toDeployment({ ...source, createdAt: old }, NOW)?.state,
      'unknown'
    );
  });

  it('drops an environment that is gone', () => {
    assert.equal(
      toDeployment({ ...source, deploymentState: 'DESTROYED' }, NOW),
      undefined
    );
    assert.equal(
      toDeployment({ ...source, deploymentState: 'ABANDONED' }, NOW),
      undefined
    );
  });

  it('drops an address a link may not carry', () => {
    const read = toDeployment(
      {
        ...source,
        statusState: 'success',
        environmentUrl: 'javascript:alert(1)',
        logUrl: 'https://dash.cloudflare.com/x',
      },
      NOW
    );
    assert.equal(read?.url, undefined);
    assert.equal(read?.logUrl, 'https://dash.cloudflare.com/x');
  });
});

describe('readHeadChecks', () => {
  it('reduces the rollup to whether the head is still building', () => {
    assert.equal(readHeadChecks('PENDING'), 'pending');
    assert.equal(readHeadChecks('EXPECTED'), 'pending');
    assert.equal(readHeadChecks('SUCCESS'), 'success');
    assert.equal(readHeadChecks('ERROR'), 'failure');
    assert.equal(readHeadChecks(null), undefined);
  });
});

describe('pagesBranchAlias', () => {
  const build = 'https://26b50519.pixai-studio.pages.dev';

  // Each of these is a live alias read off a preview comment on
  // troph-team/lilja, beside the branch it was made for.
  it('matches the aliases Cloudflare made', () => {
    assert.equal(
      pagesBranchAlias(build, 'lody/f9833855-538'),
      'https://lody-f9833855-538.pixai-studio.pages.dev/'
    );
    assert.equal(
      pagesBranchAlias(build, 'video-node-batch'),
      'https://video-node-batch.pixai-studio.pages.dev/'
    );
    assert.equal(
      pagesBranchAlias(build, 'studio-graphql-orpc-migration-92435d'),
      'https://studio-graphql-orpc-migratio.pixai-studio.pages.dev/'
    );
    assert.equal(
      pagesBranchAlias(build, 'image-loader-partial-render-caee25'),
      'https://image-loader-partial-render.pixai-studio.pages.dev/'
    );
  });

  it('lowercases the branch', () => {
    assert.equal(
      pagesBranchAlias(build, 'Feature/UI'),
      'https://feature-ui.pixai-studio.pages.dev/'
    );
  });

  it('answers only for a Pages build address', () => {
    assert.equal(
      pagesBranchAlias('https://630a1601.lilja.pixai.art', 'x'),
      undefined
    );
    assert.equal(
      pagesBranchAlias('https://main.pixai-studio.pages.dev', 'x'),
      undefined
    );
    assert.equal(pagesBranchAlias(build, undefined), undefined);
    assert.equal(pagesBranchAlias(build, '///'), undefined);
  });
});

describe('deploymentProvider', () => {
  it('names a provider by the host it serves from', () => {
    assert.deepEqual(deploymentProvider(deployment()), {
      id: 'cloudflare',
      label: 'Cloudflare Pages',
    });
    assert.equal(
      deploymentProvider(deployment({ url: 'https://x-y.vercel.app' })).id,
      'vercel'
    );
    // vercel/ai's previews answer here.
    assert.equal(
      deploymentProvider(deployment({ url: 'https://ai-sdk-docs-x.vercel.sh' }))
        .id,
      'vercel'
    );
    assert.equal(
      deploymentProvider(deployment({ url: 'https://x--y.netlify.app' })).id,
      'netlify'
    );
  });

  it("names a workflow's own deployment by its description", () => {
    assert.deepEqual(
      deploymentProvider(
        deployment({
          url: 'https://630a1601.lilja.pixai.art',
          description: 'Per-branch SSR preview',
          creatorLogin: 'github-actions[bot]',
        })
      ),
      { id: 'github', label: 'Per-branch SSR preview' }
    );
    // GraphQL drops the `[bot]` that REST writes.
    assert.equal(
      deploymentProvider(
        deployment({ url: undefined, creatorLogin: 'github-actions' })
      ).id,
      'github'
    );
    assert.equal(
      deploymentProvider(
        deployment({ url: undefined, creatorLogin: 'someone[bot]' })
      ).label,
      'someone'
    );
  });
});

describe('latestByEnvironment', () => {
  const data = (
    deployments: Deployment[],
    extra: Partial<DeploymentsData> = {}
  ): DeploymentsData => ({ headSha: HEAD, deployments, ...extra });

  it('links a current Pages build through its branch alias', () => {
    const [row] = latestByEnvironment(data([deployment()]));
    assert.equal(row?.reading, 'current');
    assert.equal(
      row?.href,
      'https://lody-f9833855-538.pixai-studio.pages.dev/'
    );
    assert.equal(row?.shown?.sha, HEAD);
  });

  it('keeps one row per environment, in name order', () => {
    const rows = latestByEnvironment(
      data([
        deployment({
          id: 1,
          environment: 'preview-elden',
          url: 'https://e.example',
        }),
        deployment({
          id: 2,
          environment: 'preview',
          sha: OLD,
          createdAt: '2026-09-30T08:00:00Z',
        }),
        deployment({ id: 3, environment: 'preview' }),
      ])
    );
    assert.deepEqual(
      rows.map((row) => [row.environment, row.newest.id]),
      [
        ['preview', 3],
        ['preview-elden', 1],
      ]
    );
  });

  it('says the head is building and links the build before it', () => {
    const [row] = latestByEnvironment(
      data([
        deployment({ id: 2, state: 'pending', url: undefined }),
        deployment({
          id: 1,
          sha: OLD,
          state: 'inactive',
          url: 'https://11111111.pixai-studio.pages.dev',
          createdAt: '2026-09-30T08:00:00Z',
        }),
      ])
    );
    assert.equal(row?.reading, 'building');
    assert.equal(row?.shown?.sha, OLD);
  });

  it('says the head failed, and falls back to the log with nothing to open', () => {
    const [row] = latestByEnvironment(
      data([
        deployment({
          state: 'failure',
          url: undefined,
          logUrl: 'https://github.com/o/r/actions/runs/1',
        }),
      ])
    );
    assert.equal(row?.reading, 'failed');
    assert.equal(row?.href, 'https://github.com/o/r/actions/runs/1');
    assert.equal(row?.shown, undefined);
  });

  it('waits while the head has no build and its checks run', () => {
    const rows = [deployment({ sha: OLD })];
    assert.equal(
      latestByEnvironment(data(rows, { headChecks: 'pending' }))[0]?.reading,
      'waiting'
    );
    assert.equal(
      latestByEnvironment(data(rows, { headChecks: 'failure' }))[0]?.reading,
      'outdated'
    );
    assert.equal(
      latestByEnvironment(data(rows, { headChecks: 'success' }))[0]?.reading,
      'outdated'
    );
  });
});

describe('deploymentsInFlight', () => {
  it('polls while a build of the head is running', () => {
    assert.equal(
      deploymentsInFlight({
        headSha: HEAD,
        deployments: [deployment({ state: 'pending' })],
      }),
      true
    );
  });

  it('polls while the head checks run and an environment is behind', () => {
    assert.equal(
      deploymentsInFlight({
        headSha: HEAD,
        headChecks: 'pending',
        deployments: [deployment({ sha: OLD })],
      }),
      true
    );
  });

  it('stops once every environment has an answer for the head', () => {
    assert.equal(
      deploymentsInFlight({
        headSha: HEAD,
        headChecks: 'pending',
        deployments: [deployment()],
      }),
      false
    );
    assert.equal(
      deploymentsInFlight({
        headSha: HEAD,
        deployments: [deployment({ state: 'failure' })],
      }),
      false
    );
  });

  it('never polls a pull request that has no deployments', () => {
    assert.equal(
      deploymentsInFlight({
        headSha: HEAD,
        headChecks: 'pending',
        deployments: [],
      }),
      false
    );
  });
});
