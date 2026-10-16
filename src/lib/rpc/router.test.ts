import { createRouterClient, ORPCError } from '@orpc/server';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { router } from './router';
import type { CommentPayload } from '@/lib/comments';
import { startRequestLog } from '@/lib/logger';
import type { PullDetails } from '@/lib/pullDetails';
import type { PullSummary } from '@/lib/pulls';
import type { SubmittedReview } from '@/lib/reviewDecision';
import {
  type DeploymentConfig,
  parseDeploymentConfig,
} from '@/lib/server/config';
import { registerForge } from '@/lib/server/forges';
import type {
  Forge,
  ForgeCapabilities,
  ForgeCredential,
} from '@/lib/server/forges/types';
import { GitHubError } from '@/lib/server/github/client';
import type { GitHubViewer } from '@/lib/viewer';

// The router's procedures, end to end against an in-memory forge. The fake
// mirrors the real GitHub forge's own guards — anonymous reads, the missing
// file-or-line 400 — so what is asserted here is the router's half: dispatch,
// credential forwarding, capability gates, and the `fail()` status mapping.

const GITHUB_REPO = { forge: 'github', owner: 'octo', repo: 'hello' } as const;
const GITHUB_PULL = { ...GITHUB_REPO, number: 7 } as const;

const VIEWER: GitHubViewer = {
  login: 'octocat',
  avatarUrl: 'https://avatars.example/octocat',
  name: 'Octo',
};

const PULL: PullSummary = {
  owner: 'octo',
  repo: 'hello',
  number: 7,
  title: 'Add a thing',
  author: 'octocat',
  state: 'open',
  htmlUrl: 'https://github.com/octo/hello/pull/7',
  updatedAt: '2026-09-01T00:00:00Z',
  headRef: 'feature',
  baseRef: 'main',
};

const DETAILS: PullDetails = {
  owner: 'octo',
  repo: 'hello',
  number: 7,
  title: 'Add a thing',
  state: 'open',
  author: 'octocat',
  htmlUrl: 'https://github.com/octo/hello/pull/7',
  headRef: 'feature',
  baseRef: 'main',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

const COMMENT: CommentPayload = {
  remoteId: 10,
  path: 'a.ts',
  author: 'octocat',
  body: 'looks good',
  line: 3,
  side: 'additions',
};

const REVIEW: SubmittedReview = { id: 1, state: 'APPROVED' };

/** One call the fake forge answered, kept for the assertions after it. */
interface RecordedCall {
  method: string;
  cred: ForgeCredential;
  ref?: unknown;
  input?: unknown;
}

interface FakeForgeOptions {
  /** What every method throws when set. */
  error?: Error;
  /** The rows `listOpenPulls` answers with. */
  pulls?: PullSummary[];
  /** Who `viewer` answers with; defaults to VIEWER. */
  viewer?: GitHubViewer;
  capabilities?: ForgeCapabilities;
  /** False leaves the `viewedFiles` methods off, for a forge without the seam. */
  keepsViewedFiles?: boolean;
  /** False leaves the `drafts` methods off, for a forge without the seam. */
  keepsDrafts?: boolean;
  /** False leaves `comments.resolve` off, for a forge without the seam. */
  resolvesThreads?: boolean;
}

function fakeForge(
  options: FakeForgeOptions = {}
): Forge & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const record = (
    method: string,
    cred: ForgeCredential,
    extra: { ref?: unknown; input?: unknown } = {}
  ): void => {
    calls.push({ method, cred, ...extra });
    if (options.error != null) throw options.error;
  };

  const forge: Forge & { calls: RecordedCall[] } = {
    capabilities: options.capabilities ?? {
      verdicts: ['APPROVE', 'COMMENT', 'REQUEST_CHANGES'],
    },
    calls,
    diff: async () => new Response(''),
    file: async () => new Response(''),
    async viewer(cred) {
      record('viewer', cred);
      // Anonymous is a first-class answer, not an error.
      return cred.token == null ? undefined : (options.viewer ?? VIEWER);
    },
    async listOpenPulls(repos, cred) {
      record('listOpenPulls', cred, { input: repos });
      return {
        // Without a token there is no viewer, and every author reads as
        // somebody else.
        viewer:
          cred.token == null ? undefined : (options.viewer ?? VIEWER).login,
        pulls: options.pulls ?? [PULL],
        failures: [],
      };
    },
    async pullDetails(ref, cred) {
      record('pullDetails', cred, { ref });
      return DETAILS;
    },
    comments: {
      async list(ref, cred) {
        record('comments.list', cred, { ref });
        return [COMMENT];
      },
      async create(ref, input, cred) {
        record('comments.create', cred, { ref, input });
        // The GitHub forge's own guard: a new thread must name a line.
        if (
          input.replyToId == null &&
          (input.path == null || input.line == null)
        ) {
          throw new GitHubError(
            400,
            'This comment is missing a file or line number.'
          );
        }
        return {
          ...COMMENT,
          remoteId: 11,
          body: input.body,
          replyToId: input.replyToId,
        };
      },
      async remove(ref, commentId, cred) {
        record('comments.remove', cred, { ref, input: commentId });
      },
    },
    reviews: {
      async mine(ref, cred) {
        record('reviews.mine', cred, { ref });
        // The verdict is the token's own, so there is nothing to ask without
        // one.
        return cred.token == null ? undefined : REVIEW;
      },
      async submit(ref, input, cred) {
        record('reviews.submit', cred, { ref, input });
        return REVIEW;
      },
    },
  };
  if (options.resolvesThreads !== false) {
    forge.comments.resolve = async (ref, input, cred) => {
      record('comments.resolve', cred, { ref, input });
    };
  }
  if (options.keepsViewedFiles !== false) {
    forge.viewedFiles = {
      async list(ref, cred) {
        record('viewedFiles.list', cred, { ref });
        // The mark is the token's own: anonymous is an empty list, not an
        // error.
        return { paths: cred.token == null ? [] : ['a.ts'] };
      },
      async set(ref, input, cred) {
        record('viewedFiles.set', cred, { ref, input });
      },
    };
  }
  if (options.keepsDrafts !== false) {
    forge.drafts = {
      async list(ref, cred) {
        record('drafts.list', cred, { ref });
        return [{ ...COMMENT, staged: true, remoteNodeId: 'PRRC_node_1' }];
      },
      async create(ref, input, cred) {
        record('drafts.create', cred, { ref, input });
        return {
          ...COMMENT,
          remoteId: 12,
          body: input.body,
          staged: true,
        };
      },
      async remove(ref, input, cred) {
        record('drafts.remove', cred, { ref, input });
      },
    };
  }
  return forge;
}

function callsOf(
  forge: Forge & { calls: RecordedCall[] },
  method: string
): RecordedCall[] {
  return forge.calls.filter((call) => call.method === method);
}

/** The variables of a deployment whose GitHub is served through an App. */
const GITHUB_APP = {
  GITHUB_APP_CLIENT_ID: 'Iv1.test',
  GITHUB_APP_CLIENT_SECRET: 'app-secret',
} as const;

/** The router as a typed client, with the route's context fixed per test. */
function clientFor(
  context: {
    config?: DeploymentConfig;
    byForge?: Record<string, ForgeCredential>;
    headerToken?: string;
    refreshDue?: boolean;
  } = {}
) {
  const { config, byForge = {}, headerToken, refreshDue = false } = context;
  return createRouterClient(router, {
    context: {
      config: config ?? parseDeploymentConfig(GITHUB_APP),
      log: startRequestLog(new Request('http://localhost/')).logger,
      credentials: {
        // The shape `resolveCredentials` fills: the github slot always
        // carries `fromSession`, whether or not it names a session.
        byForge: {
          ...byForge,
          ...(byForge.github == null
            ? {}
            : { github: { fromSession: undefined, ...byForge.github } }),
        },
        headerToken,
        refreshDue,
      },
    },
  });
}

/** Runs one procedure call; the logger the handlers read rides the context. */
async function callRpc<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

/**
 * Asserts the code, status and message a failed call surfaces with. A string
 * `message` is pinned whole — that is for prose GitHub wrote, passed through
 * untouched. App-authored copy takes a `fragment`, the piece that carries its
 * meaning: a test that pinned the whole sentence would fail on every copy pass
 * and say nothing about whether the panel offers the right thing. `failure`
 * asserts the typed reason the error's data carries; `null` asserts the error
 * carries none.
 */
async function expectRpcError(
  promise: Promise<unknown>,
  expected: {
    code: string;
    status: number;
    message: string | { fragment: string };
    failure?: { reason: string; forge?: string; host?: string } | null;
  }
): Promise<void> {
  const error: unknown = await promise.catch((cause: unknown) => cause);
  assert.ok(error instanceof ORPCError);
  assert.equal(error.code, expected.code);
  assert.equal(error.status, expected.status);
  if (typeof expected.message === 'string') {
    assert.equal(error.message, expected.message);
  } else {
    assert.ok(
      error.message.includes(expected.message.fragment),
      `Expected ${JSON.stringify(error.message)} to contain ${JSON.stringify(
        expected.message.fragment
      )}`
    );
  }
  if (expected.failure !== undefined) {
    const data = error.data as { failure?: unknown } | undefined;
    if (expected.failure === null) {
      assert.equal(data?.failure, undefined);
    } else {
      assert.deepEqual(data?.failure, expected.failure);
    }
  }
}

describe('refreshDue middleware', () => {
  it('answers every procedure 401 before it runs', async () => {
    const forge = fakeForge();
    registerForge('github', forge);
    const client = clientFor({
      refreshDue: true,
      byForge: { github: { token: 'ghu_spent' } },
    });

    await expectRpcError(
      callRpc(() => client.viewer.get()),
      {
        code: 'UNAUTHORIZED',
        status: 401,
        message: { fragment: 'no longer valid' },
        failure: { reason: 'auth-expired' },
      }
    );
    await expectRpcError(
      callRpc(() => client.comments.list(GITHUB_PULL)),
      {
        code: 'UNAUTHORIZED',
        status: 401,
        message: { fragment: 'no longer valid' },
        failure: { reason: 'auth-expired' },
      }
    );
    // The procedure never ran: a 401 is the only answer the client refreshes
    // on, so the forge must not see the call.
    assert.equal(forge.calls.length, 0);
  });
});

describe('viewer.get', () => {
  it('answers with nobody for a caller with no token', async () => {
    registerForge('github', fakeForge());
    const result = await callRpc(() => clientFor({}).viewer.get());
    assert.equal(result.viewer, undefined);
    assert.equal(result.fromSession, false);
  });

  it('answers with the viewer and forwards the credential', async () => {
    const forge = fakeForge();
    registerForge('github', forge);
    const result = await callRpc(() =>
      clientFor({
        byForge: { github: { token: 'ghu_x', fromSession: true } },
      }).viewer.get()
    );
    assert.deepEqual(result, { fromSession: true, viewer: VIEWER });
    assert.deepEqual(callsOf(forge, 'viewer')[0].cred, {
      token: 'ghu_x',
      fromSession: true,
    });
  });
});

describe('installations.list', () => {
  it('answers an empty list and no install URL with no App configured', async () => {
    const result = await callRpc(() =>
      clientFor({ config: parseDeploymentConfig({}) }).installations.list()
    );
    assert.deepEqual(result.installations, []);
    assert.equal(result.installUrl, undefined);
  });

  it('derives the install URL from the configured App slug', async () => {
    const result = await callRpc(() =>
      clientFor({
        config: parseDeploymentConfig({
          GITHUB_APP_CLIENT_ID: 'Iv1.test',
          GITHUB_APP_CLIENT_SECRET: 'secret',
          GITHUB_APP_SLUG: 'ghdiff-test',
        }),
      }).installations.list()
    );
    assert.deepEqual(result.installations, []);
    assert.equal(
      result.installUrl,
      'https://github.com/apps/ghdiff-test/installations/new'
    );
  });
});

describe('pulls.list', () => {
  it('answers with nothing for an empty watch list', async () => {
    const forge = fakeForge();
    registerForge('github', forge);
    const result = await callRpc(() => clientFor({}).pulls.list({ repos: [] }));
    assert.deepEqual(result.viewers, {});
    assert.deepEqual(result.pulls, []);
    assert.deepEqual(result.failures, []);
    assert.equal(forge.calls.length, 0);
  });

  it('caps the watch list at 25 repositories', async () => {
    const forge = fakeForge();
    registerForge('github', forge);
    const repos = Array.from({ length: 30 }, (_, index) => ({
      forge: 'github' as const,
      owner: 'octo',
      repo: `repo-${index}`,
    }));
    await callRpc(() => clientFor({}).pulls.list({ repos }));
    const seen = callsOf(forge, 'listOpenPulls')[0].input as unknown[];
    assert.equal(seen.length, 25);
  });

  it('dedupes repositories by label, case aside', async () => {
    const forge = fakeForge();
    registerForge('github', forge);
    await callRpc(() =>
      clientFor({}).pulls.list({
        repos: [
          { forge: 'github', owner: 'Octo', repo: 'Hello' },
          { forge: 'github', owner: 'octo', repo: 'hello' },
        ],
      })
    );
    const seen = callsOf(forge, 'listOpenPulls')[0].input as unknown[];
    assert.equal(seen.length, 1);
  });
});

describe('pulls.get', () => {
  it('passes the forge answer through', async () => {
    const forge = fakeForge();
    registerForge('github', forge);
    const result = await callRpc(() =>
      clientFor({ byForge: { github: { token: 'ghu_x' } } }).pulls.get(
        GITHUB_PULL
      )
    );
    assert.deepEqual(result, DETAILS);
    const call = callsOf(forge, 'pullDetails')[0];
    assert.deepEqual(call.ref, GITHUB_PULL);
    assert.deepEqual(call.cred, { token: 'ghu_x', fromSession: undefined });
  });

  it('carries a GraphQL error from a 200 as BAD_GATEWAY, sentence intact', async () => {
    // oRPC masks an error status under 400 as a bare 500, which would hide
    // the forge's own explanation behind "Internal server error".
    registerForge(
      'github',
      fakeForge({
        error: new GitHubError(
          200,
          'Could not resolve to a Repository with the name of gone.'
        ),
      })
    );
    await expectRpcError(
      callRpc(() => clientFor({}).pulls.get(GITHUB_PULL)),
      {
        code: 'BAD_GATEWAY',
        status: 502,
        message: 'Could not resolve to a Repository with the name of gone.',
      }
    );
  });

  it('maps a forge 404 to NOT_FOUND with the forge message', async () => {
    registerForge(
      'github',
      fakeForge({ error: new GitHubError(404, 'Not Found') })
    );
    await expectRpcError(
      callRpc(() => clientFor({}).pulls.get(GITHUB_PULL)),
      {
        code: 'NOT_FOUND',
        status: 404,
        message: 'Not Found',
      }
    );
  });

  it('rejects a pull request number that is not positive', async () => {
    registerForge('github', fakeForge());
    await assert.rejects(
      callRpc(() => clientFor({}).pulls.get({ ...GITHUB_REPO, number: -3 })),
      ORPCError
    );
  });
});

// The status is what survives the trip to the browser, so every lane of
// `codeForStatus` is pinned here, through `pulls.get` as the vehicle. The
// typed failure rides the error's data beside it.
describe('fail mapping', () => {
  it('maps a credentialed 401 to UNAUTHORIZED and auth-expired', async () => {
    registerForge(
      'github',
      fakeForge({ error: new GitHubError(401, 'Bad credentials') })
    );
    await expectRpcError(
      callRpc(() =>
        clientFor({ byForge: { github: { token: 'ghu_x' } } }).pulls.get(
          GITHUB_PULL
        )
      ),
      {
        code: 'UNAUTHORIZED',
        status: 401,
        message: 'Bad credentials',
        failure: { reason: 'auth-expired', forge: 'github' },
      }
    );
  });

  it('maps an anonymous 401 to UNAUTHORIZED and auth-required', async () => {
    registerForge(
      'github',
      fakeForge({ error: new GitHubError(401, 'Requires authentication') })
    );
    await expectRpcError(
      callRpc(() => clientFor({}).pulls.get(GITHUB_PULL)),
      {
        code: 'UNAUTHORIZED',
        status: 401,
        message: 'Requires authentication',
        failure: { reason: 'auth-required', forge: 'github' },
      }
    );
  });

  it('maps a 403 to FORBIDDEN and permission-denied', async () => {
    registerForge(
      'github',
      fakeForge({ error: new GitHubError(403, 'Resource not accessible') })
    );
    await expectRpcError(
      callRpc(() =>
        clientFor({ byForge: { github: { token: 'ghu_x' } } }).pulls.get(
          GITHUB_PULL
        )
      ),
      {
        code: 'FORBIDDEN',
        status: 403,
        message: 'Resource not accessible',
        failure: { reason: 'permission-denied', forge: 'github' },
      }
    );
  });

  it('maps a forge 404 to NOT_FOUND and not-found', async () => {
    registerForge(
      'github',
      fakeForge({ error: new GitHubError(404, 'Not Found') })
    );
    await expectRpcError(
      callRpc(() => clientFor({}).pulls.get(GITHUB_PULL)),
      {
        code: 'NOT_FOUND',
        status: 404,
        message: 'Not Found',
        failure: { reason: 'not-found', forge: 'github' },
      }
    );
  });

  it('maps a spent quota to TOO_MANY_REQUESTS and rate-limited', async () => {
    registerForge(
      'github',
      fakeForge({ error: new GitHubError(429, 'API rate limit exceeded') })
    );
    await expectRpcError(
      callRpc(() => clientFor({}).pulls.get(GITHUB_PULL)),
      {
        code: 'TOO_MANY_REQUESTS',
        status: 429,
        message: 'API rate limit exceeded',
        failure: { reason: 'rate-limited', forge: 'github' },
      }
    );
  });

  it('maps a 5xx to BAD_GATEWAY, so the message survives the wire', async () => {
    registerForge(
      'github',
      fakeForge({ error: new GitHubError(503, 'Service Unavailable') })
    );
    await expectRpcError(
      callRpc(() => clientFor({}).pulls.get(GITHUB_PULL)),
      {
        code: 'BAD_GATEWAY',
        status: 503,
        message: 'Service Unavailable',
        failure: null,
      }
    );
  });

  it('maps a failure that is not a GitHubError to a 500 with its own message', async () => {
    registerForge('github', fakeForge({ error: new Error('socket hang up') }));
    await expectRpcError(
      callRpc(() => clientFor({}).pulls.get(GITHUB_PULL)),
      {
        code: 'INTERNAL_SERVER_ERROR',
        status: 500,
        message: 'socket hang up',
        failure: null,
      }
    );
  });
});

// The gate's 404 is a GitHubError raised before the forge runs, and it must
// reach the browser as that 404 with its sentence — which is why the ref
// middleware maps `forgeFor`'s failure through `fail()` the way a handler did.
describe('forge gate', () => {
  const gate = {
    code: 'NOT_FOUND',
    status: 404,
    message: { fragment: 'no forges' },
    failure: { reason: 'not-served', forge: 'github' },
  };
  // A deployment with neither the App nor a token serves no GitHub at all.
  const config = parseDeploymentConfig({});
  const byForge = { github: { token: 'ghu_x' } };

  it('answers an unserved ref 404 in reviews.submit', async () => {
    registerForge('github', fakeForge());
    await expectRpcError(
      callRpc(() =>
        clientFor({ config, byForge }).reviews.submit({
          ...GITHUB_PULL,
          event: 'APPROVE',
        })
      ),
      gate
    );
  });

  it('answers an unserved ref 404 in comments.create', async () => {
    registerForge('github', fakeForge());
    await expectRpcError(
      callRpc(() =>
        clientFor({ config, byForge }).comments.create({
          ...GITHUB_PULL,
          body: 'A note.',
          path: 'a.ts',
          line: 3,
        })
      ),
      gate
    );
  });

  it('answers an unserved ref 404 in comments.remove', async () => {
    registerForge('github', fakeForge());
    await expectRpcError(
      callRpc(() =>
        clientFor({ config, byForge }).comments.remove({
          ...GITHUB_PULL,
          commentId: 10,
        })
      ),
      gate
    );
  });

  it('answers an unserved ref 404 in viewedFiles.set', async () => {
    registerForge('github', fakeForge());
    await expectRpcError(
      callRpc(() =>
        clientFor({ config, byForge }).viewedFiles.set({
          ...GITHUB_PULL,
          path: 'a.ts',
          viewed: true,
        })
      ),
      gate
    );
  });
});

describe('reviews.mine', () => {
  it('answers with no review for a caller with no token', async () => {
    registerForge('github', fakeForge());
    const result = await callRpc(() => clientFor({}).reviews.mine(GITHUB_PULL));
    assert.deepEqual(result, {});
  });

  it('answers with the review the token already left', async () => {
    registerForge('github', fakeForge());
    const result = await callRpc(() =>
      clientFor({ byForge: { github: { token: 'ghu_x' } } }).reviews.mine(
        GITHUB_PULL
      )
    );
    assert.deepEqual(result, { review: REVIEW });
  });
});

describe('reviews.submit', () => {
  it('asks for a token before a verdict', async () => {
    registerForge('github', fakeForge());
    await expectRpcError(
      callRpc(() =>
        clientFor({}).reviews.submit({ ...GITHUB_PULL, event: 'APPROVE' })
      ),
      {
        code: 'UNAUTHORIZED',
        status: 401,
        message: { fragment: 'before you submit a review' },
        failure: { reason: 'auth-required', forge: 'github' },
      }
    );
  });

  it('submits and returns the recorded review', async () => {
    const forge = fakeForge();
    registerForge('github', forge);
    const result = await callRpc(() =>
      clientFor({ byForge: { github: { token: 'ghu_x' } } }).reviews.submit({
        ...GITHUB_PULL,
        event: 'REQUEST_CHANGES',
        body: 'Please rework this.',
      })
    );
    assert.deepEqual(result, REVIEW);
    assert.deepEqual(callsOf(forge, 'reviews.submit')[0].input, {
      event: 'REQUEST_CHANGES',
      body: 'Please rework this.',
    });
  });

  it("passes the forge's own 422 sentence through", async () => {
    registerForge(
      'github',
      fakeForge({
        error: new GitHubError(422, 'Review cannot be submitted.'),
      })
    );
    await expectRpcError(
      callRpc(() =>
        clientFor({ byForge: { github: { token: 'ghu_x' } } }).reviews.submit({
          ...GITHUB_PULL,
          event: 'APPROVE',
        })
      ),
      {
        code: 'BAD_REQUEST',
        status: 422,
        message: 'Review cannot be submitted.',
      }
    );
  });
});

describe('viewedFiles.list', () => {
  it('answers the marked paths', async () => {
    registerForge('github', fakeForge());
    const result = await callRpc(() =>
      clientFor({ byForge: { github: { token: 'ghu_x' } } }).viewedFiles.list(
        GITHUB_PULL
      )
    );
    assert.deepEqual(result, { paths: ['a.ts'] });
  });

  it('answers an empty list rather than an error with no token', async () => {
    registerForge('github', fakeForge());
    const result = await callRpc(() =>
      clientFor({}).viewedFiles.list(GITHUB_PULL)
    );
    assert.deepEqual(result, { paths: [] });
  });

  it('refuses a forge that keeps no marks', async () => {
    registerForge('github', fakeForge({ keepsViewedFiles: false }));
    await expectRpcError(
      callRpc(() => clientFor({}).viewedFiles.list(GITHUB_PULL)),
      {
        code: 'BAD_REQUEST',
        status: 400,
        message: { fragment: 'keeps no viewed-file marks' },
      }
    );
  });
});

describe('viewedFiles.set', () => {
  it('asks for a token before a mark', async () => {
    registerForge('github', fakeForge());
    await expectRpcError(
      callRpc(() =>
        clientFor({}).viewedFiles.set({
          ...GITHUB_PULL,
          path: 'a.ts',
          viewed: true,
        })
      ),
      {
        code: 'UNAUTHORIZED',
        status: 401,
        message: { fragment: 'before you mark a file as viewed' },
        failure: { reason: 'auth-required', forge: 'github' },
      }
    );
  });

  it('marks the file and answers ok', async () => {
    const forge = fakeForge();
    registerForge('github', forge);
    const result = await callRpc(() =>
      clientFor({ byForge: { github: { token: 'ghu_x' } } }).viewedFiles.set({
        ...GITHUB_PULL,
        path: 'a.ts',
        viewed: true,
      })
    );
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(callsOf(forge, 'viewedFiles.set')[0].input, {
      path: 'a.ts',
      viewed: true,
    });
  });
});

describe('comments.list', () => {
  it('passes the forge answer through', async () => {
    const forge = fakeForge();
    registerForge('github', forge);
    const result = await callRpc(() =>
      clientFor({}).comments.list(GITHUB_PULL)
    );
    assert.deepEqual(result, [COMMENT]);
    assert.deepEqual(callsOf(forge, 'comments.list')[0].ref, GITHUB_PULL);
  });
});

describe('comments.create', () => {
  it('asks for a token before a comment', async () => {
    registerForge('github', fakeForge());
    await expectRpcError(
      callRpc(() =>
        clientFor({}).comments.create({
          ...GITHUB_PULL,
          body: 'A note.',
          path: 'a.ts',
          line: 3,
          side: 'additions',
        })
      ),
      {
        code: 'UNAUTHORIZED',
        status: 401,
        message: { fragment: 'before you comment' },
        failure: { reason: 'auth-required', forge: 'github' },
      }
    );
  });

  it('creates a comment on a line', async () => {
    const forge = fakeForge();
    registerForge('github', forge);
    const result = await callRpc(() =>
      clientFor({ byForge: { github: { token: 'ghu_x' } } }).comments.create({
        ...GITHUB_PULL,
        body: 'A note.',
        path: 'a.ts',
        line: 3,
        side: 'additions',
      })
    );
    assert.equal(result.remoteId, 11);
    assert.equal(result.body, 'A note.');
    const call = callsOf(forge, 'comments.create')[0];
    assert.deepEqual(call.ref, GITHUB_PULL);
    assert.deepEqual(call.cred, { token: 'ghu_x', fromSession: undefined });
  });

  it('sends a reply with no path or line of its own', async () => {
    const forge = fakeForge();
    registerForge('github', forge);
    const result = await callRpc(() =>
      clientFor({ byForge: { github: { token: 'ghu_x' } } }).comments.create({
        ...GITHUB_PULL,
        body: 'Me too.',
        replyToId: 10,
      })
    );
    assert.equal(result.replyToId, 10);
    const input = callsOf(forge, 'comments.create')[0].input as {
      replyToId?: number;
      path?: string;
      line?: number;
    };
    assert.equal(input.replyToId, 10);
    assert.equal(input.path, undefined);
    assert.equal(input.line, undefined);
  });

  it("passes the forge's file-or-line guard through as a 400", async () => {
    registerForge('github', fakeForge());
    await expectRpcError(
      callRpc(() =>
        clientFor({ byForge: { github: { token: 'ghu_x' } } }).comments.create({
          ...GITHUB_PULL,
          body: 'A note with nowhere to go.',
        })
      ),
      {
        code: 'BAD_REQUEST',
        status: 400,
        message: { fragment: 'missing a file or line number' },
      }
    );
  });

  it('rejects an empty body before the forge is asked', async () => {
    const forge = fakeForge();
    registerForge('github', forge);
    await assert.rejects(
      callRpc(() =>
        clientFor({ byForge: { github: { token: 'ghu_x' } } }).comments.create({
          ...GITHUB_PULL,
          body: '   ',
          path: 'a.ts',
          line: 3,
        })
      ),
      ORPCError
    );
    assert.equal(callsOf(forge, 'comments.create').length, 0);
  });
});

describe('comments.remove', () => {
  it('asks for a token before a delete', async () => {
    registerForge('github', fakeForge());
    await expectRpcError(
      callRpc(() =>
        clientFor({}).comments.remove({ ...GITHUB_PULL, commentId: 10 })
      ),
      {
        code: 'UNAUTHORIZED',
        status: 401,
        message: { fragment: 'before you delete a comment' },
        failure: { reason: 'auth-required', forge: 'github' },
      }
    );
  });

  it('deletes the comment and answers ok', async () => {
    const forge = fakeForge();
    registerForge('github', forge);
    const result = await callRpc(() =>
      clientFor({ byForge: { github: { token: 'ghu_x' } } }).comments.remove({
        ...GITHUB_PULL,
        commentId: 10,
      })
    );
    assert.deepEqual(result, { ok: true });
    const call = callsOf(forge, 'comments.remove')[0];
    assert.deepEqual(call.ref, GITHUB_PULL);
    assert.equal(call.input, 10);
  });
});

describe('comments.resolve', () => {
  it('asks for a token before a resolve', async () => {
    registerForge('github', fakeForge());
    await expectRpcError(
      callRpc(() =>
        clientFor({}).comments.resolve({
          ...GITHUB_PULL,
          threadId: 'PRRT_node_1',
          resolved: true,
        })
      ),
      {
        code: 'UNAUTHORIZED',
        status: 401,
        message: { fragment: 'before you resolve a thread' },
        failure: { reason: 'auth-required', forge: 'github' },
      }
    );
  });

  it('marks the thread and answers the state it sent', async () => {
    const forge = fakeForge();
    registerForge('github', forge);
    const result = await callRpc(() =>
      clientFor({ byForge: { github: { token: 'ghu_x' } } }).comments.resolve({
        ...GITHUB_PULL,
        threadId: 'PRRT_node_1',
        resolved: false,
      })
    );
    assert.deepEqual(result, { resolved: false });
    const call = callsOf(forge, 'comments.resolve')[0];
    assert.deepEqual(call.ref, GITHUB_PULL);
    assert.deepEqual(call.input, {
      threadId: 'PRRT_node_1',
      resolved: false,
    });
    assert.deepEqual(call.cred, { token: 'ghu_x', fromSession: undefined });
  });

  it('refuses a forge whose threads take no mark', async () => {
    registerForge('github', fakeForge({ resolvesThreads: false }));
    await expectRpcError(
      callRpc(() =>
        clientFor({ byForge: { github: { token: 'ghu_x' } } }).comments.resolve(
          {
            ...GITHUB_PULL,
            threadId: 'PRRT_node_1',
            resolved: true,
          }
        )
      ),
      {
        code: 'BAD_REQUEST',
        status: 400,
        message: { fragment: 'resolves no review threads' },
      }
    );
  });
});

describe('drafts.list', () => {
  it('answers the forge’s anonymous answer rather than gating', async () => {
    const forge = fakeForge();
    registerForge('github', forge);
    const result = await callRpc(() => clientFor({}).drafts.list(GITHUB_PULL));
    // A public review loads with nobody signed in, so the router does not
    // stand in front of the forge: an anonymous caller gets whatever the
    // forge answers with no credential — both real adapters answer an empty
    // list.
    assert.deepEqual(result, {
      drafts: [{ ...COMMENT, staged: true, remoteNodeId: 'PRRC_node_1' }],
    });
    assert.deepEqual(callsOf(forge, 'drafts.list')[0].cred, {});
  });

  it('surfaces a spent grant as the typed failure, not an empty list', async () => {
    registerForge(
      'github',
      fakeForge({ error: new GitHubError(401, 'Bad credentials') })
    );
    await expectRpcError(
      callRpc(() =>
        clientFor({
          byForge: { github: { token: 'ghu_revoked' } },
        }).drafts.list(GITHUB_PULL)
      ),
      {
        code: 'UNAUTHORIZED',
        status: 401,
        message: 'Bad credentials',
        failure: { reason: 'auth-expired', forge: 'github' },
      }
    );
  });

  it('answers the forge’s drafts with the credential forwarded', async () => {
    const forge = fakeForge();
    registerForge('github', forge);
    const result = await callRpc(() =>
      clientFor({ byForge: { github: { token: 'ghu_x' } } }).drafts.list(
        GITHUB_PULL
      )
    );
    assert.deepEqual(result, {
      drafts: [{ ...COMMENT, staged: true, remoteNodeId: 'PRRC_node_1' }],
    });
    const call = callsOf(forge, 'drafts.list')[0];
    assert.deepEqual(call.ref, GITHUB_PULL);
    assert.deepEqual(call.cred, { token: 'ghu_x', fromSession: undefined });
  });

  it('refuses a forge that keeps no drafts', async () => {
    registerForge('github', fakeForge({ keepsDrafts: false }));
    await expectRpcError(
      callRpc(() =>
        clientFor({ byForge: { github: { token: 'ghu_x' } } }).drafts.list(
          GITHUB_PULL
        )
      ),
      {
        code: 'BAD_REQUEST',
        status: 400,
        message: { fragment: 'keeps no review drafts' },
      }
    );
  });
});

describe('drafts.create', () => {
  it('asks for a token before a draft', async () => {
    registerForge('github', fakeForge());
    await expectRpcError(
      callRpc(() =>
        clientFor({}).drafts.create({
          ...GITHUB_PULL,
          body: 'A note.',
          path: 'a.ts',
          line: 3,
          side: 'additions',
        })
      ),
      {
        code: 'UNAUTHORIZED',
        status: 401,
        message: { fragment: 'before you stage a comment' },
        failure: { reason: 'auth-required', forge: 'github' },
      }
    );
  });

  it('creates the draft and answers its payload', async () => {
    const forge = fakeForge();
    registerForge('github', forge);
    const result = await callRpc(() =>
      clientFor({ byForge: { github: { token: 'ghu_x' } } }).drafts.create({
        ...GITHUB_PULL,
        body: 'A note.',
        path: 'a.ts',
        line: 3,
        side: 'additions',
        startLine: 2,
        startSide: 'additions',
      })
    );
    assert.equal(result.remoteId, 12);
    assert.equal(result.body, 'A note.');
    assert.equal(result.staged, true);
    const call = callsOf(forge, 'drafts.create')[0];
    assert.deepEqual(call.ref, GITHUB_PULL);
    assert.deepEqual(call.input, {
      body: 'A note.',
      path: 'a.ts',
      line: 3,
      side: 'additions',
      startLine: 2,
      startSide: 'additions',
    });
    assert.deepEqual(call.cred, { token: 'ghu_x', fromSession: undefined });
  });

  it('refuses a forge that keeps no drafts', async () => {
    registerForge('github', fakeForge({ keepsDrafts: false }));
    await expectRpcError(
      callRpc(() =>
        clientFor({ byForge: { github: { token: 'ghu_x' } } }).drafts.create({
          ...GITHUB_PULL,
          body: 'A note.',
          path: 'a.ts',
          line: 3,
          side: 'additions',
        })
      ),
      {
        code: 'BAD_REQUEST',
        status: 400,
        message: { fragment: 'keeps no review drafts' },
      }
    );
  });
});

describe('drafts.remove', () => {
  it('asks for a token before a delete', async () => {
    registerForge('github', fakeForge());
    await expectRpcError(
      callRpc(() => clientFor({}).drafts.remove({ ...GITHUB_PULL, id: 10 })),
      {
        code: 'UNAUTHORIZED',
        status: 401,
        message: { fragment: 'before you delete a staged comment' },
        failure: { reason: 'auth-required', forge: 'github' },
      }
    );
  });

  it('deletes the draft and answers ok', async () => {
    const forge = fakeForge();
    registerForge('github', forge);
    const result = await callRpc(() =>
      clientFor({ byForge: { github: { token: 'ghu_x' } } }).drafts.remove({
        ...GITHUB_PULL,
        nodeId: 'PRRC_node_1',
      })
    );
    assert.deepEqual(result, { ok: true });
    const call = callsOf(forge, 'drafts.remove')[0];
    assert.deepEqual(call.ref, GITHUB_PULL);
    assert.deepEqual(call.input, { id: undefined, nodeId: 'PRRC_node_1' });
  });

  it('rejects a delete that names neither id before the forge is asked', async () => {
    const forge = fakeForge();
    registerForge('github', forge);
    await assert.rejects(
      callRpc(() =>
        clientFor({ byForge: { github: { token: 'ghu_x' } } }).drafts.remove(
          GITHUB_PULL
        )
      ),
      ORPCError
    );
    assert.equal(callsOf(forge, 'drafts.remove').length, 0);
  });

  it('refuses a forge that keeps no drafts', async () => {
    registerForge('github', fakeForge({ keepsDrafts: false }));
    await expectRpcError(
      callRpc(() =>
        clientFor({ byForge: { github: { token: 'ghu_x' } } }).drafts.remove({
          ...GITHUB_PULL,
          id: 10,
        })
      ),
      {
        code: 'BAD_REQUEST',
        status: 400,
        message: { fragment: 'keeps no review drafts' },
      }
    );
  });
});

describe('stats.served', () => {
  it('answers the counter as a number', async () => {
    const result = await callRpc(() => clientFor({}).stats.served());
    assert.equal(typeof result.count, 'number');
  });
});
