import {
  assertGitHubHeaders,
  GITHUB_API,
  GITHUB_RAW,
  GITHUB_WEB,
  graphQLCalls,
  graphQLErrors,
  graphQLRoute,
  mockCompareEndpoint,
  mockContents,
  mockCreateComment,
  mockCreateIssue,
  mockDeleteComment,
  mockGetPull,
  mockGetUser,
  mockGraphQL,
  mockImageHost,
  mockIssueComments,
  mockListComments,
  mockListCommentsPages,
  mockListPulls,
  mockPullDiff,
  mockPullFiles,
  mockPullReviews,
  mockReplyToComment,
  mockSubmitReview,
  mockSubmitReviewEvents,
  mockWebDiff,
  mockWebRaw,
} from '@test/msw/github';
import {
  callDiff,
  expectGitHubError,
  fixture,
  requests,
  requestsTo,
  resetMocks,
  server,
} from '@test/msw/shared';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

import { githubForge } from './github';
import type { PullRef, RepoRef } from '@/lib/forges';
import type { GitHubTarget } from '@/lib/reviewTarget';
import { GITHUB_API_VERSION } from '@/lib/server/github/client';

// The forge against msw: real HTTP through octokit and the hand-rolled
// fetchers, answered with the responses `test/fixtures/record/github.mjs`
// recorded from GitHub itself (see `test/fixtures/github/_meta.json`). The
// GraphQL answers are hand-shaped — api.github.com/graphql refuses an
// anonymous caller, so no real one can be recorded — and are marked where
// they appear.

// ghostty-org/ghostty's open pull requests, its #14052 with six review
// comments, GalvinGao/ghdiff#6's files page, a compare of two adjacent
// GalvinGao/ghdiff commits, and GalvinGao/ghdiff#13's .diff. The fixtures
// travel as mock bodies and nothing reads their fields, so they stay the
// parsed JSON they are.
const PULLS = fixture<unknown[]>('github', 'pulls.json');
const PULL = fixture<unknown>('github', 'pull.json');
const COMMENTS = fixture<Record<string, unknown>[]>(
  'github',
  'pull-comments.json'
);
const FILES = fixture<unknown[]>('github', 'pull-files.json');
const COMPARE = fixture<unknown>('github', 'compare.json');
const USER_401 = fixture<unknown>('github', 'user-401.json');
const DIFF_TEXT = readFileSync(
  new URL('../../../../test/fixtures/github/pull.diff', import.meta.url),
  'utf8'
);

const TOKEN = 'ghu_test_token';

const GHOSTTY_REPO: RepoRef = {
  forge: 'github',
  owner: 'ghostty-org',
  repo: 'ghostty',
};
const GHOSTTY_PULL: PullRef = { ...GHOSTTY_REPO, number: 14052 };

const GHDIFF_PULL_13_TARGET: GitHubTarget = {
  kind: 'github-pull',
  owner: 'GalvinGao',
  repo: 'ghdiff',
  number: 13,
};
const GHDIFF_PULL_6_TARGET: GitHubTarget = {
  kind: 'github-pull',
  owner: 'GalvinGao',
  repo: 'ghdiff',
  number: 6,
};

beforeAll(() => {
  server.listen();
});

afterEach(() => {
  resetMocks();
});

afterAll(() => {
  server.close();
});

/**
 * Scripts the two GraphQL reads behind the pending-review lookup: the
 * viewer's login, then the viewer's newest review. `review` undefined is the
 * no-pending answer.
 */
function mockPendingReviewLookup(review?: {
  id: string;
  databaseId: number;
  state: string;
}): void {
  mockGraphQL(
    graphQLRoute(
      ['ViewerLogin', () => ({ viewer: { login: 'octocat' } })],
      [
        'PendingReview',
        () => ({
          repository: {
            pullRequest: {
              reviews: { nodes: review == null ? [] : [review] },
            },
          },
        }),
      ]
    )
  );
}

describe('viewer', () => {
  it('maps the token’s user', async () => {
    // Hand-shaped: /user answers only for a credential, so nothing anonymous
    // can be recorded. The 401 below is the recorded one.
    mockGetUser({
      login: 'octocat',
      avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
      name: 'Octo Cat',
    });
    const viewer = await githubForge.viewer({ token: TOKEN });
    assert.deepEqual(viewer, {
      login: 'octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
      name: 'Octo Cat',
    });
    const [call] = requestsTo(GITHUB_API, '/user');
    assertGitHubHeaders(call, { token: TOKEN });
  });

  it('answers with nobody and asks nothing without a token', async () => {
    const viewer = await githubForge.viewer({});
    assert.equal(viewer, undefined);
    assert.equal(requests.length, 0);
  });

  it('turns a 401 into a GitHubError with GitHub’s sentence', async () => {
    mockGetUser(USER_401, { status: 401 });
    await expectGitHubError(githubForge.viewer({ token: 'bad-token' }), {
      status: 401,
      message: 'Bad credentials',
    });
  });
});

describe('the octokit client', () => {
  it('carries the API version header on an authed request', async () => {
    // The header rides a request hook that amends the options in place:
    // the auth hook's endpoint.merge drops a replacement object, so a
    // regression there silently loses the header on authed calls. The
    // constant is the contract; the mechanism is what this pins.
    mockGetUser({ login: 'octocat' });
    await githubForge.viewer({ token: TOKEN });

    const [call] = requestsTo(GITHUB_API, '/user');
    assert.equal(call.headers['x-github-api-version'], GITHUB_API_VERSION);
  });
});

/**
 * A pull request as the GraphQL list carries it, with the review requests the
 * hand-shaped answer decides. Field shapes follow OPEN_PULLS_QUERY in the
 * forge.
 */
function graphQLPull(
  number: number,
  reviewRequestNodes: unknown[]
): Record<string, unknown> {
  return {
    number,
    title: `Pull request ${number}`,
    url: `https://github.com/ghostty-org/ghostty/pull/${number}`,
    isDraft: false,
    updatedAt: '2026-09-01T00:00:00Z',
    headRefName: 'feature',
    baseRefName: 'main',
    headRefOid: '0ddba11',
    reviewDecision: null,
    author: { login: 'octocat', avatarUrl: 'https://example.com/octo.png' },
    commits: { nodes: [] },
    reviews: { nodes: [] },
    latestOpinionatedReviews: { nodes: [] },
    reviewRequests: { nodes: reviewRequestNodes },
  };
}

describe('listOpenPulls', () => {
  it('reads the REST list and reports no status without a token', async () => {
    mockListPulls('ghostty-org', 'ghostty', PULLS);
    const result = await githubForge.listOpenPulls([GHOSTTY_REPO], {});

    assert.equal(result.viewer, undefined);
    assert.deepEqual(result.failures, []);
    assert.equal(result.pulls.length, PULLS.length);
    const first = result.pulls[0];
    assert.equal(first.number, 14108);
    assert.equal(first.author, 'EriksRemess');
    assert.equal(first.state, 'open');
    assert.equal(
      first.htmlUrl,
      'https://github.com/ghostty-org/ghostty/pull/14108'
    );
    assert.equal(first.headRef, 'gtk-notification-lifecycle');
    assert.equal(first.baseRef, 'main');
    assert.equal(first.status, undefined);

    // The REST endpoint answered; GraphQL was never asked.
    const [call] = requestsTo(GITHUB_API, '/repos/ghostty-org/ghostty/pulls');
    assert.equal(call.query.state, 'open');
    assert.equal(call.query.per_page, '100');
    assert.equal(graphQLCalls().length, 0);
    assertGitHubHeaders(call);
  });

  it('reads the GraphQL list with a token and normalizes both axes', async () => {
    // Hand-shaped: GraphQL refuses an anonymous caller. Field shapes follow
    // OPEN_PULLS_QUERY in the forge, and the viewer rides every answer.
    const green = {
      number: 101,
      title: 'A green pull request',
      url: 'https://github.com/ghostty-org/ghostty/pull/101',
      isDraft: false,
      updatedAt: '2026-09-01T00:00:00Z',
      headRefName: 'feature',
      baseRefName: 'main',
      headRefOid: '0ddba11',
      reviewDecision: 'APPROVED',
      author: { login: 'octocat', avatarUrl: 'https://example.com/octo.png' },
      commits: {
        nodes: [
          {
            commit: {
              oid: '0ddba11',
              committedDate: '2026-09-01T00:00:00Z',
              statusCheckRollup: { state: 'SUCCESS' },
            },
          },
        ],
      },
      reviews: { nodes: [] },
      latestOpinionatedReviews: { nodes: [{ state: 'APPROVED' }] },
    };
    const changes = {
      ...green,
      number: 102,
      title: 'Needs another pass',
      reviewDecision: 'CHANGES_REQUESTED',
      headRefOid: 'c0ffee2',
      author: { login: 'monalisa', avatarUrl: 'https://example.com/mona.png' },
      commits: {
        nodes: [
          {
            commit: {
              oid: 'c0ffee2',
              committedDate: '2026-09-05T00:00:00Z',
              statusCheckRollup: { state: 'FAILURE' },
            },
          },
        ],
      },
      reviews: { nodes: [{ submittedAt: '2026-09-03T00:00:00Z' }] },
      latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED' }] },
    };
    mockGraphQL(
      graphQLRoute([
        'pullRequests',
        () => ({
          viewer: { login: 'reviewer' },
          repository: { pullRequests: { nodes: [green, changes] } },
        }),
      ])
    );

    const result = await githubForge.listOpenPulls([GHOSTTY_REPO], {
      token: TOKEN,
    });

    assert.equal(result.viewer, 'reviewer');
    assert.deepEqual(result.failures, []);
    const approved = result.pulls.find((pull) => pull.number === 101);
    assert.equal(approved?.title, 'A green pull request');
    assert.equal(approved?.author, 'octocat');
    assert.equal(approved?.state, 'open');
    assert.deepEqual(approved?.status, {
      review: 'approved',
      check: 'success',
    });
    const requested = result.pulls.find((pull) => pull.number === 102);
    assert.deepEqual(requested?.status, {
      review: 'changes',
      check: 'failure',
      commitsSinceChanges: true,
    });

    // GraphQL answered; the REST list was never asked.
    const [call] = graphQLCalls();
    assert.deepEqual(call.variables, {
      owner: 'ghostty-org',
      repo: 'ghostty',
      first: 100,
    });
    assert.equal(
      requestsTo(GITHUB_API, '/repos/ghostty-org/ghostty/pulls').length,
      0
    );
    assertGitHubHeaders(requestsTo(GITHUB_API, '/graphql')[0], {
      token: TOKEN,
    });
  });

  it('marks the rows asking for the viewer’s review', async () => {
    // Hand-shaped, like the axes above: the login matches without case, a
    // duplicated request node answers the same way once, and a team request
    // names nobody.
    mockGraphQL(
      graphQLRoute([
        'pullRequests',
        () => ({
          viewer: { login: 'reviewer' },
          repository: {
            pullRequests: {
              nodes: [
                graphQLPull(101, [
                  {
                    requestedReviewer: {
                      __typename: 'User',
                      login: 'Reviewer',
                    },
                  },
                  {
                    requestedReviewer: {
                      __typename: 'User',
                      login: 'Reviewer',
                    },
                  },
                ]),
                graphQLPull(102, [
                  {
                    requestedReviewer: {
                      __typename: 'User',
                      login: 'someone-else',
                    },
                  },
                ]),
                graphQLPull(103, [
                  { requestedReviewer: { __typename: 'Team' } },
                ]),
              ],
            },
          },
        }),
      ])
    );

    const result = await githubForge.listOpenPulls([GHOSTTY_REPO], {
      token: TOKEN,
    });

    const marked = (number: number) =>
      result.pulls.find((pull) => pull.number === number)?.reviewRequested;
    assert.equal(marked(101), true);
    assert.equal(marked(102), undefined);
    assert.equal(marked(103), undefined);
  });

  it('marks nothing when the answer names no viewer', async () => {
    mockGraphQL(
      graphQLRoute([
        'pullRequests',
        () => ({
          viewer: null,
          repository: {
            pullRequests: {
              nodes: [
                graphQLPull(101, [
                  {
                    requestedReviewer: {
                      __typename: 'User',
                      login: 'reviewer',
                    },
                  },
                ]),
              ],
            },
          },
        }),
      ])
    );

    const result = await githubForge.listOpenPulls([GHOSTTY_REPO], {
      token: TOKEN,
    });

    assert.equal(result.pulls[0]?.reviewRequested, undefined);
  });

  it('keeps one repository’s answer when another 404s', async () => {
    mockListPulls('ghostty-org', 'ghostty', PULLS);
    mockListPulls('octo', 'gone', { message: 'Not Found' }, { status: 404 });
    const result = await githubForge.listOpenPulls(
      [GHOSTTY_REPO, { forge: 'github', owner: 'octo', repo: 'gone' }],
      {}
    );

    assert.equal(result.pulls.length, PULLS.length);
    assert.deepEqual(result.failures, [
      { repo: 'octo/gone', message: 'Not Found' },
    ]);
  });
});

describe('pullDetails', () => {
  it('maps a real pull payload through toPullDetails', async () => {
    mockGetPull('ghostty-org', 'ghostty', 14052, PULL);
    // Hand-shaped: GraphQL refuses an anonymous caller. Field shapes follow
    // PULL_CHECK_QUERY in the forge.
    mockGraphQL(
      graphQLRoute([
        'PullCheck',
        () => ({
          repository: {
            pullRequest: {
              headRefOid: '0ddba11',
              commits: {
                nodes: [
                  {
                    commit: {
                      oid: '0ddba11',
                      statusCheckRollup: { state: 'SUCCESS' },
                    },
                  },
                ],
              },
            },
          },
        }),
      ])
    );
    const details = await githubForge.pullDetails(GHOSTTY_PULL, {
      token: TOKEN,
    });

    assert.equal(details.owner, 'ghostty-org');
    assert.equal(details.repo, 'ghostty');
    assert.equal(details.number, 14052);
    assert.equal(
      details.title,
      'gtk,opengl: free us from the clutches of GtkGLArea'
    );
    assert.equal(details.state, 'open');
    assert.equal(details.author, 'pluiedev');
    assert.equal(
      details.authorAvatarUrl,
      'https://avatars.githubusercontent.com/u/22406910?v=4'
    );
    assert.equal(
      details.htmlUrl,
      'https://github.com/ghostty-org/ghostty/pull/14052'
    );
    assert.equal(details.headRef, 'pluie/jj-mlzvrzmqpnvs');
    assert.equal(details.baseRef, 'main');
    assert.equal(details.createdAt, '2026-08-27T21:41:08Z');
    assert.equal(details.updatedAt, '2026-09-06T07:05:40Z');
    assert.ok(details.body?.startsWith('GtkGLArea had numerous downsides'));
    assert.equal(details.additions, 2071);
    assert.equal(details.deletions, 640);
    assert.equal(details.changedFiles, 45);
    assert.equal(details.commits, 12);
    assert.equal(details.check, 'success');
    assertGitHubHeaders(requests[0], { token: TOKEN });
  });

  it('asks for no check without a token', async () => {
    mockGetPull('ghostty-org', 'ghostty', 14052, PULL);
    const details = await githubForge.pullDetails(GHOSTTY_PULL, {});

    assert.equal(details.check, undefined);
    assert.equal(graphQLCalls().length, 0);
  });

  it('keeps the details when the check read fails', async () => {
    mockGetPull('ghostty-org', 'ghostty', 14052, PULL);
    mockGraphQL(graphQLRoute(['PullCheck', () => graphQLErrors('boom')]));
    const details = await githubForge.pullDetails(GHOSTTY_PULL, {
      token: TOKEN,
    });

    assert.equal(details.number, 14052);
    assert.equal(details.check, undefined);
  });

  it('reads no check from a rollup that is not the head commit', async () => {
    mockGetPull('ghostty-org', 'ghostty', 14052, PULL);
    mockGraphQL(
      graphQLRoute([
        'PullCheck',
        () => ({
          repository: {
            pullRequest: {
              headRefOid: '0ddba11',
              commits: {
                nodes: [
                  {
                    commit: {
                      oid: 'older-sha',
                      statusCheckRollup: { state: 'FAILURE' },
                    },
                  },
                ],
              },
            },
          },
        }),
      ])
    );
    const details = await githubForge.pullDetails(GHOSTTY_PULL, {
      token: TOKEN,
    });

    assert.equal(details.check, 'none');
  });

  it('turns a 404 into a GitHubError', async () => {
    mockGetPull(
      'ghostty-org',
      'ghostty',
      14052,
      { message: 'Not Found' },
      { status: 404 }
    );
    await expectGitHubError(
      githubForge.pullDetails(GHOSTTY_PULL, { token: TOKEN }),
      { status: 404, message: 'Not Found' }
    );
  });
});

describe('comments.list', () => {
  // Hand-shaped, as every GraphQL answer here is: api.github.com/graphql
  // refuses an anonymous caller, so no real one can be recorded. Field shapes
  // follow REVIEW_THREADS_QUERY in the forge.
  const RESOLVED_THREAD = {
    id: 'PRRT_node_resolved',
    isResolved: true,
    path: 'src/gtk.zig',
    line: 157,
    originalLine: 157,
    startLine: 150,
    originalStartLine: 150,
    diffSide: 'RIGHT',
    startDiffSide: 'RIGHT',
    comments: {
      nodes: [
        {
          databaseId: 3906566685,
          id: 'PRRC_node_root',
          author: {
            __typename: 'User',
            login: 'mitchellh',
            avatarUrl: 'https://example.com/m.png',
          },
          body: 'A root note.',
          createdAt: '2026-09-01T10:00:00Z',
          url: 'https://github.com/ghostty-org/ghostty/pull/14052#discussion_r3906566685',
          pullRequestReview: { databaseId: 5046498750 },
        },
        {
          databaseId: 3911643066,
          id: 'PRRC_node_reply',
          author: { __typename: 'Bot', login: 'ghostty-bot', avatarUrl: null },
          body: 'A reply.',
          createdAt: '2026-09-01T11:00:00Z',
          url: 'https://github.com/ghostty-org/ghostty/pull/14052#discussion_r3911643066',
          pullRequestReview: { databaseId: 5046498750 },
        },
      ],
    },
  };
  const OPEN_THREAD = {
    id: 'PRRT_node_open',
    isResolved: false,
    path: 'src/main.zig',
    line: 12,
    originalLine: 12,
    startLine: null,
    originalStartLine: null,
    diffSide: 'LEFT',
    startDiffSide: null,
    comments: {
      nodes: [
        {
          databaseId: 3876626378,
          id: 'PRRC_node_open',
          author: {
            __typename: 'User',
            login: 'pluiedev',
            avatarUrl: 'https://example.com/p.png',
          },
          body: 'An open note.',
          createdAt: '2026-09-02T10:00:00Z',
          url: 'https://github.com/ghostty-org/ghostty/pull/14052#discussion_r3876626378',
          pullRequestReview: { databaseId: 5046498751 },
        },
      ],
    },
  };

  it('reads the REST comments anonymously, with no resolution state to report', async () => {
    // GraphQL refuses an anonymous caller, so the signed-out read is the REST
    // flat list it always was — the recorded six comments of ghostty#14052.
    mockListComments('ghostty-org', 'ghostty', 14052, COMMENTS);
    const payloads = await githubForge.comments.list(GHOSTTY_PULL, {});

    assert.equal(payloads.length, 6);
    const root = payloads.find((payload) => payload.remoteId === 3906566685);
    assert.equal(root?.author, 'mitchellh');
    assert.equal(root?.line, 157);
    assert.equal(root?.side, 'additions');
    assert.equal(root?.resolved, undefined);
    assert.equal(root?.threadId, undefined);
    const reply = payloads.find((payload) => payload.remoteId === 3911643066);
    assert.equal(reply?.replyToId, 3906566685);

    // GraphQL was never asked.
    assert.equal(graphQLCalls().length, 0);
    const [call] = requestsTo(
      GITHUB_API,
      '/repos/ghostty-org/ghostty/pulls/14052/comments'
    );
    assert.equal(call.query.per_page, '100');
    assertGitHubHeaders(call);
  });

  it('follows the REST pages anonymously until a short one', async () => {
    // Page 1 is padded to a full page out of the six recorded comments — the
    // pager only asks for page 2 when page 1 comes back full.
    const full = Array.from({ length: 100 }, (_, index) => ({
      ...COMMENTS[index % COMMENTS.length],
      id: 1000 + index,
    }));
    mockListCommentsPages('ghostty-org', 'ghostty', 14052, {
      1: full,
      2: COMMENTS,
    });
    const payloads = await githubForge.comments.list(GHOSTTY_PULL, {});

    assert.equal(payloads.length, 106);
    const calls = requestsTo(
      GITHUB_API,
      '/repos/ghostty-org/ghostty/pulls/14052/comments'
    );
    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.map((call) => call.query.page),
      ['1', '2']
    );
  });

  it('maps review threads to payloads, resolved state on the root only', async () => {
    mockGraphQL(
      graphQLRoute([
        'reviewThreads',
        () => ({
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [RESOLVED_THREAD, OPEN_THREAD],
              },
            },
          },
        }),
      ])
    );
    const payloads = await githubForge.comments.list(GHOSTTY_PULL, {
      token: TOKEN,
    });

    assert.equal(payloads.length, 3);
    const root = payloads.find((payload) => payload.remoteId === 3906566685);
    assert.deepEqual(root, {
      remoteId: 3906566685,
      remoteNodeId: 'PRRC_node_root',
      author: 'mitchellh',
      authorAvatarUrl: 'https://example.com/m.png',
      authorIsBot: false,
      body: 'A root note.',
      createdAt: '2026-09-01T10:00:00Z',
      htmlUrl:
        'https://github.com/ghostty-org/ghostty/pull/14052#discussion_r3906566685',
      path: 'src/gtk.zig',
      line: 157,
      startLine: 150,
      side: 'additions',
      startSide: 'additions',
      resolved: true,
      threadId: 'PRRT_node_resolved',
    });

    // The reply threads to the root's databaseId; the state and the thread id
    // stay on the root. GraphQL types an App's account as 'Bot'.
    const reply = payloads.find((payload) => payload.remoteId === 3911643066);
    assert.equal(reply?.replyToId, 3906566685);
    assert.equal(reply?.authorIsBot, true);
    assert.equal(reply?.resolved, undefined);
    assert.equal(reply?.threadId, undefined);
    assert.equal(reply?.path, 'src/gtk.zig');

    const open = payloads.find((payload) => payload.remoteId === 3876626378);
    assert.equal(open?.resolved, undefined);
    assert.equal(open?.threadId, 'PRRT_node_open');
    assert.equal(open?.side, 'deletions');
    assert.equal(open?.startSide, undefined);

    const [call] = graphQLCalls();
    assert.deepEqual(call.variables, {
      owner: 'ghostty-org',
      repo: 'ghostty',
      number: 14052,
      first: 100,
      after: null,
    });
    // The REST comment list was never asked.
    assert.equal(
      requestsTo(GITHUB_API, '/repos/ghostty-org/ghostty/pulls/14052/comments')
        .length,
      0
    );
    assertGitHubHeaders(requestsTo(GITHUB_API, '/graphql')[0], {
      token: TOKEN,
    });
  });

  it('falls back to the original line when the diff moved under a thread', async () => {
    mockGraphQL(
      graphQLRoute([
        'reviewThreads',
        () => ({
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{ ...OPEN_THREAD, line: null, originalLine: 15 }],
              },
            },
          },
        }),
      ])
    );
    const payloads = await githubForge.comments.list(GHOSTTY_PULL, {
      token: TOKEN,
    });
    assert.equal(payloads[0]?.line, 15);
  });

  it('leaves a pending review’s threads to the drafts read', async () => {
    // A staged comment is a thread on the viewer's own pending review, and
    // the drafts read owns it: listed here too, one staged comment would
    // draw twice.
    const PENDING_THREAD = {
      ...OPEN_THREAD,
      id: 'PRRT_node_pending',
      comments: {
        nodes: [
          {
            ...OPEN_THREAD.comments.nodes[0],
            databaseId: 3876626379,
            id: 'PRRC_node_pending',
            pullRequestReview: { databaseId: 5046498752, state: 'PENDING' },
          },
        ],
      },
    };
    mockGraphQL(
      graphQLRoute([
        'reviewThreads',
        () => ({
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [PENDING_THREAD, OPEN_THREAD],
              },
            },
          },
        }),
      ])
    );
    const payloads = await githubForge.comments.list(GHOSTTY_PULL, {
      token: TOKEN,
    });

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0]?.remoteId, 3876626378);
  });

  it('leaves a reply pending under a published root to the drafts read', async () => {
    // A reply staged on github.com sits on the viewer's pending review while
    // its thread is published: the root lists here, the reply does not.
    const MIXED_THREAD = {
      ...OPEN_THREAD,
      comments: {
        nodes: [
          OPEN_THREAD.comments.nodes[0],
          {
            ...OPEN_THREAD.comments.nodes[0],
            databaseId: 3876626380,
            id: 'PRRC_node_pending_reply',
            pullRequestReview: { databaseId: 5046498752, state: 'PENDING' },
          },
        ],
      },
    };
    mockGraphQL(
      graphQLRoute([
        'reviewThreads',
        () => ({
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [MIXED_THREAD],
              },
            },
          },
        }),
      ])
    );
    const payloads = await githubForge.comments.list(GHOSTTY_PULL, {
      token: TOKEN,
    });

    assert.deepEqual(
      payloads.map((payload) => payload.remoteId),
      [3876626378]
    );
  });

  it('follows the pages while there is a next one', async () => {
    mockGraphQL(
      graphQLRoute([
        'reviewThreads',
        (variables) =>
          variables.after == null
            ? {
                repository: {
                  pullRequest: {
                    reviewThreads: {
                      pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
                      nodes: [RESOLVED_THREAD],
                    },
                  },
                },
              }
            : {
                repository: {
                  pullRequest: {
                    reviewThreads: {
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes: [OPEN_THREAD],
                    },
                  },
                },
              },
      ])
    );
    const payloads = await githubForge.comments.list(GHOSTTY_PULL, {
      token: TOKEN,
    });

    assert.equal(payloads.length, 3);
    const calls = graphQLCalls();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].variables.after, 'cursor-1');
  });
});

describe('comments.create', () => {
  it('posts a reply with only its body', async () => {
    // COMMENTS[2] is pluiedev's recorded reply to mitchellh's root.
    mockReplyToComment(
      'ghostty-org',
      'ghostty',
      14052,
      3906566685,
      COMMENTS[2]
    );
    const payload = await githubForge.comments.create(
      GHOSTTY_PULL,
      { body: 'Me too.', replyToId: 3906566685 },
      { token: TOKEN }
    );

    const [post] = requests.filter((record) => record.method === 'POST');
    assert.equal(
      post.path,
      '/repos/ghostty-org/ghostty/pulls/14052/comments/3906566685/replies'
    );
    assert.deepEqual(post.body, { body: 'Me too.' });
    assert.equal(payload.remoteId, 3911643066);
    assert.equal(payload.replyToId, 3906566685);
  });

  it('reads the head commit, then posts a line comment naming it', async () => {
    mockGetPull('ghostty-org', 'ghostty', 14052, PULL);
    mockCreateComment('ghostty-org', 'ghostty', 14052, COMMENTS[1]);
    // The thread the comment landed on, answered the way the comments read
    // answers: the create's payload takes its Resolve identity from it, so a
    // fresh thread needs no reload to offer the resolve press.
    mockGraphQL(
      graphQLRoute([
        'reviewThreads',
        () => ({
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: 'PRRT_node_new',
                    isResolved: false,
                    path: 'src/gtk.zig',
                    line: 157,
                    originalLine: 157,
                    startLine: null,
                    originalStartLine: null,
                    diffSide: 'RIGHT',
                    startDiffSide: null,
                    comments: {
                      nodes: [
                        {
                          databaseId: 3906566685,
                          id: 'PRRC_node_new',
                          author: {
                            __typename: 'User',
                            login: 'mitchellh',
                            avatarUrl: 'https://example.com/m.png',
                          },
                          body: 'A note.',
                          createdAt: '2026-09-01T10:00:00Z',
                          url: 'https://github.com/ghostty-org/ghostty/pull/14052#discussion_r3906566685',
                          pullRequestReview: {
                            databaseId: 5046498750,
                            state: 'COMMENTED',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        }),
      ])
    );
    const payload = await githubForge.comments.create(
      GHOSTTY_PULL,
      { body: 'A note.', path: 'src/gtk.zig', line: 157, side: 'additions' },
      { token: TOKEN }
    );

    const postIndex = requests.findIndex((record) => record.method === 'POST');
    const getIndex = requests.findIndex(
      (record) =>
        record.method === 'GET' &&
        record.path === '/repos/ghostty-org/ghostty/pulls/14052'
    );
    assert.ok(getIndex >= 0 && getIndex < postIndex);
    assert.deepEqual(requests[postIndex].body, {
      body: 'A note.',
      commit_id: '25baa198ba9a087a03b70755b71974937196bef0',
      path: 'src/gtk.zig',
      line: 157,
      side: 'RIGHT',
    });
    assert.equal(payload.remoteId, 3906566685);
    assert.equal(payload.threadId, 'PRRT_node_new');
    assert.equal(payload.remoteNodeId, 'PRRC_node_new');
    assert.equal(payload.path, 'src/gtk.zig');
    assert.equal(payload.side, 'additions');
  });

  it('keeps the creation when the thread read fails', async () => {
    mockGetPull('ghostty-org', 'ghostty', 14052, PULL);
    mockCreateComment('ghostty-org', 'ghostty', 14052, COMMENTS[1]);
    // The write landed; a metadata read that fails costs the identity, not
    // the comment — a failure here would invite the retry that duplicates
    // it. The identity arrives on the next read.
    mockGraphQL(() => graphQLErrors('Could not read the threads'));
    const payload = await githubForge.comments.create(
      GHOSTTY_PULL,
      { body: 'A note.', path: 'src/gtk.zig', line: 157, side: 'additions' },
      { token: TOKEN }
    );

    assert.equal(payload.remoteId, 3906566685);
    assert.equal(payload.threadId, undefined);
    assert.equal(payload.remoteNodeId, undefined);
  });

  it('adds start_line and start_side for a range', async () => {
    mockGetPull('ghostty-org', 'ghostty', 14052, PULL);
    mockCreateComment('ghostty-org', 'ghostty', 14052, COMMENTS[1]);
    await githubForge.comments.create(
      GHOSTTY_PULL,
      {
        body: 'A range.',
        path: 'src/gtk.zig',
        line: 10,
        side: 'additions',
        startLine: 4,
        startSide: 'additions',
      },
      { token: TOKEN }
    );

    const [post] = requests.filter((record) => record.method === 'POST');
    assert.deepEqual(post.body, {
      body: 'A range.',
      commit_id: '25baa198ba9a087a03b70755b71974937196bef0',
      path: 'src/gtk.zig',
      line: 10,
      side: 'RIGHT',
      start_line: 4,
      start_side: 'RIGHT',
    });
  });

  it('refuses a comment with no file or line before asking GitHub', async () => {
    await expectGitHubError(
      githubForge.comments.create(
        GHOSTTY_PULL,
        { body: 'Nowhere to land.' },
        { token: TOKEN }
      ),
      { status: 400, message: { fragment: 'missing a file or line number' } }
    );
    assert.equal(requests.length, 0);
  });
});

describe('comments.remove', () => {
  it('deletes by the pull-request comment path', async () => {
    mockDeleteComment('ghostty-org', 'ghostty', 3938764375);
    await githubForge.comments.remove(
      { ...GHOSTTY_REPO, number: 7 },
      3938764375,
      { token: TOKEN }
    );

    const [call] = requests;
    assert.equal(call.method, 'DELETE');
    assert.equal(
      call.path,
      '/repos/ghostty-org/ghostty/pulls/comments/3938764375'
    );
    assertGitHubHeaders(call, { token: TOKEN });
  });
});

describe('comments.resolve', () => {
  function mockResolveMutations(): void {
    mockGraphQL(
      graphQLRoute(
        // The unresolve string contains the resolve one, so it is routed first.
        [
          'unresolveReviewThread',
          () => ({ unresolveReviewThread: { clientMutationId: null } }),
        ],
        [
          'resolveReviewThread',
          () => ({ resolveReviewThread: { clientMutationId: null } }),
        ]
      )
    );
  }

  it('resolves through the resolve mutation, by the thread’s node id', async () => {
    mockResolveMutations();
    await githubForge.comments.resolve?.(
      GHOSTTY_PULL,
      { threadId: 'PRRT_node_1', resolved: true },
      { token: TOKEN }
    );

    const [call] = graphQLCalls();
    assert.ok(!call.query.includes('unresolveReviewThread'));
    assert.ok(call.query.includes('resolveReviewThread'));
    assert.deepEqual(call.variables, { threadId: 'PRRT_node_1' });
    assertGitHubHeaders(requestsTo(GITHUB_API, '/graphql')[0], {
      token: TOKEN,
    });
  });

  it('unresolves through the other mutation', async () => {
    mockResolveMutations();
    await githubForge.comments.resolve?.(
      GHOSTTY_PULL,
      { threadId: 'PRRT_node_1', resolved: false },
      { token: TOKEN }
    );

    const [call] = graphQLCalls();
    assert.ok(call.query.includes('unresolveReviewThread'));
    assert.deepEqual(call.variables, { threadId: 'PRRT_node_1' });
  });

  it('surfaces GitHub’s refusal in its own sentence', async () => {
    mockGraphQL(() =>
      graphQLErrors('You do not have permission to resolve this thread.')
    );
    await expectGitHubError(
      githubForge.comments.resolve!(
        GHOSTTY_PULL,
        { threadId: 'PRRT_node_1', resolved: true },
        { token: TOKEN }
      ),
      {
        status: 200,
        message: 'You do not have permission to resolve this thread.',
      }
    );
  });
});

describe('reviews.mine', () => {
  it('answers with nothing when the viewer never reviewed', async () => {
    mockGraphQL(
      graphQLRoute([
        'viewerLatestReview',
        () => ({ repository: { pullRequest: { viewerLatestReview: null } } }),
      ])
    );
    const review = await githubForge.reviews.mine(GHOSTTY_PULL, {
      token: TOKEN,
    });
    assert.equal(review, undefined);
  });

  it('maps a recorded review', async () => {
    mockGraphQL(
      graphQLRoute([
        'viewerLatestReview',
        () => ({
          repository: {
            pullRequest: {
              viewerLatestReview: {
                databaseId: 987654,
                state: 'APPROVED',
                submittedAt: '2026-09-01T10:00:00Z',
                url: 'https://github.com/ghostty-org/ghostty/pull/14052#pullrequestreview-987654',
              },
            },
          },
        }),
      ])
    );
    const review = await githubForge.reviews.mine(GHOSTTY_PULL, {
      token: TOKEN,
    });
    assert.deepEqual(review, {
      id: 987654,
      state: 'APPROVED',
      submittedAt: '2026-09-01T10:00:00Z',
      htmlUrl:
        'https://github.com/ghostty-org/ghostty/pull/14052#pullrequestreview-987654',
    });
    const [call] = graphQLCalls();
    assert.deepEqual(call.variables, {
      owner: 'ghostty-org',
      repo: 'ghostty',
      number: 14052,
    });
  });

  it('turns GraphQL errors in a 200 into a GitHubError', async () => {
    mockGraphQL(() =>
      graphQLErrors('Could not resolve to a Repository with the name of gone.')
    );
    await expectGitHubError(
      githubForge.reviews.mine(GHOSTTY_PULL, { token: TOKEN }),
      {
        status: 200,
        message: 'Could not resolve to a Repository with the name of gone.',
      }
    );
  });
});

describe('reviews.submit', () => {
  it('omits an empty body from the payload', async () => {
    mockPendingReviewLookup();
    mockSubmitReview('ghostty-org', 'ghostty', 14052, {
      id: 555,
      state: 'APPROVED',
      submitted_at: '2026-09-02T00:00:00Z',
      html_url:
        'https://github.com/ghostty-org/ghostty/pull/14052#pullrequestreview-555',
    });
    const review = await githubForge.reviews.submit(
      GHOSTTY_PULL,
      { event: 'APPROVE', body: '   ' },
      { token: TOKEN }
    );

    const [post] = requests.filter(
      (record) => record.method === 'POST' && record.path.endsWith('/reviews')
    );
    assert.equal(post.path, '/repos/ghostty-org/ghostty/pulls/14052/reviews');
    assert.deepEqual(post.body, { event: 'APPROVE' });
    assert.deepEqual(review, {
      id: 555,
      state: 'APPROVED',
      submittedAt: '2026-09-02T00:00:00Z',
      htmlUrl:
        'https://github.com/ghostty-org/ghostty/pull/14052#pullrequestreview-555',
    });
  });

  it('passes the event and a trimmed body through', async () => {
    mockPendingReviewLookup();
    mockSubmitReview('ghostty-org', 'ghostty', 14052, {
      id: 556,
      state: 'CHANGES_REQUESTED',
      submitted_at: '2026-09-02T01:00:00Z',
      html_url:
        'https://github.com/ghostty-org/ghostty/pull/14052#pullrequestreview-556',
    });
    await githubForge.reviews.submit(
      GHOSTTY_PULL,
      { event: 'REQUEST_CHANGES', body: '  Please rework this.  ' },
      { token: TOKEN }
    );

    const [post] = requests.filter(
      (record) => record.method === 'POST' && record.path.endsWith('/reviews')
    );
    assert.deepEqual(post.body, {
      event: 'REQUEST_CHANGES',
      body: 'Please rework this.',
    });
  });

  it('submits the pending review through its events endpoint', async () => {
    // Hand-shaped, as every GraphQL answer here is: the viewer's one pending
    // review, found by the lookup ahead of the verdict.
    mockPendingReviewLookup({
      id: 'PRR_node_1',
      databaseId: 777,
      state: 'PENDING',
    });
    mockSubmitReviewEvents('ghostty-org', 'ghostty', 14052, 777, {
      id: 777,
      state: 'APPROVED',
      submitted_at: '2026-09-02T02:00:00Z',
      html_url:
        'https://github.com/ghostty-org/ghostty/pull/14052#pullrequestreview-777',
    });
    const review = await githubForge.reviews.submit(
      GHOSTTY_PULL,
      { event: 'APPROVE', body: '  Ship it.  ' },
      { token: TOKEN }
    );

    const [post] = requests.filter(
      (record) => record.method === 'POST' && record.path.endsWith('/events')
    );
    assert.equal(
      post.path,
      '/repos/ghostty-org/ghostty/pulls/14052/reviews/777/events'
    );
    assert.deepEqual(post.body, { event: 'APPROVE', body: 'Ship it.' });
    assertGitHubHeaders(post, { token: TOKEN });
    assert.deepEqual(review, {
      id: 777,
      state: 'APPROVED',
      submittedAt: '2026-09-02T02:00:00Z',
      htmlUrl:
        'https://github.com/ghostty-org/ghostty/pull/14052#pullrequestreview-777',
    });
    // The reviews endpoint was never asked: the verdict rode the pending one.
    assert.equal(
      requests.filter(
        (record) => record.method === 'POST' && record.path.endsWith('/reviews')
      ).length,
      0
    );
  });

  it('surfaces the validation detail rather than the status name', async () => {
    // Hand-shaped from GitHub's real 422 shape: recording one needs a token
    // and a pull request of one's own. The detail sentence is the one the
    // reviewer needs; 'Unprocessable Entity' is only the status name.
    mockPendingReviewLookup();
    mockSubmitReview(
      'ghostty-org',
      'ghostty',
      14052,
      {
        message: 'Unprocessable Entity',
        errors: [
          {
            resource: 'PullRequestReview',
            code: 'custom',
            message: 'Review cannot be submitted on your own pull request.',
          },
        ],
      },
      { status: 422 }
    );
    await expectGitHubError(
      githubForge.reviews.submit(
        GHOSTTY_PULL,
        { event: 'APPROVE' },
        { token: TOKEN }
      ),
      {
        status: 422,
        message: 'Review cannot be submitted on your own pull request.',
      }
    );
  });
});

describe('drafts.list', () => {
  // Hand-shaped, as every GraphQL answer here is. Field shapes follow
  // REVIEW_THREADS_QUERY in the forge: one thread on the viewer's pending
  // review, one on a submitted one — the review each comment belongs to is
  // what the filter reads.
  const DRAFT_THREAD = {
    id: 'PRRT_node_draft',
    isResolved: false,
    path: 'src/gtk.zig',
    line: 157,
    originalLine: 157,
    startLine: 150,
    originalStartLine: 150,
    diffSide: 'RIGHT',
    startDiffSide: 'RIGHT',
    comments: {
      nodes: [
        {
          databaseId: 5001,
          id: 'PRRC_node_1',
          author: {
            __typename: 'User',
            login: 'octocat',
            avatarUrl: 'https://example.com/octo.png',
          },
          body: 'A staged note.',
          createdAt: '2026-09-02T10:00:00Z',
          url: 'https://github.com/ghostty-org/ghostty/pull/14052#discussion_r5001',
          pullRequestReview: { databaseId: 777 },
        },
      ],
    },
  };
  const SUBMITTED_THREAD = {
    ...DRAFT_THREAD,
    id: 'PRRT_node_submitted',
    comments: {
      nodes: [
        {
          ...DRAFT_THREAD.comments.nodes[0],
          databaseId: 5003,
          id: 'PRRC_node_3',
          pullRequestReview: { databaseId: 778 },
        },
      ],
    },
  };

  it('maps the pending review’s threads to staged payloads', async () => {
    mockGraphQL(
      graphQLRoute(
        ['ViewerLogin', () => ({ viewer: { login: 'octocat' } })],
        [
          'reviewThreads',
          () => ({
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [DRAFT_THREAD, SUBMITTED_THREAD],
                },
              },
            },
          }),
        ],
        [
          'PendingReview',
          () => ({
            repository: {
              pullRequest: {
                reviews: {
                  nodes: [
                    { id: 'PRR_node_1', databaseId: 777, state: 'PENDING' },
                  ],
                },
              },
            },
          }),
        ]
      )
    );
    const drafts = await githubForge.drafts?.list(GHOSTTY_PULL, {
      token: TOKEN,
    });

    // Only the pending review's thread maps, and its position comes from the
    // thread — the comment type has no side of its own to report.
    assert.deepEqual(drafts, [
      {
        remoteId: 5001,
        remoteNodeId: 'PRRC_node_1',
        author: 'octocat',
        authorAvatarUrl: 'https://example.com/octo.png',
        body: 'A staged note.',
        createdAt: '2026-09-02T10:00:00Z',
        htmlUrl:
          'https://github.com/ghostty-org/ghostty/pull/14052#discussion_r5001',
        path: 'src/gtk.zig',
        line: 157,
        startLine: 150,
        side: 'additions',
        startSide: 'additions',
        staged: true,
      },
    ]);
    // The viewer, the pending lookup, then the threads.
    const calls = graphQLCalls();
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[2].variables, {
      owner: 'ghostty-org',
      repo: 'ghostty',
      number: 14052,
      first: 100,
      after: null,
    });
  });

  it('carries a reply staged under a published thread, pointed at its root', async () => {
    const MIXED_THREAD = {
      ...SUBMITTED_THREAD,
      comments: {
        nodes: [
          SUBMITTED_THREAD.comments.nodes[0],
          {
            ...DRAFT_THREAD.comments.nodes[0],
            databaseId: 5004,
            id: 'PRRC_node_4',
            body: 'A staged reply.',
            pullRequestReview: { databaseId: 777, state: 'PENDING' },
          },
        ],
      },
    };
    mockGraphQL(
      graphQLRoute(
        ['ViewerLogin', () => ({ viewer: { login: 'octocat' } })],
        [
          'reviewThreads',
          () => ({
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [MIXED_THREAD],
                },
              },
            },
          }),
        ],
        [
          'PendingReview',
          () => ({
            repository: {
              pullRequest: {
                reviews: {
                  nodes: [
                    { id: 'PRR_node_1', databaseId: 777, state: 'PENDING' },
                  ],
                },
              },
            },
          }),
        ]
      )
    );
    const drafts = await githubForge.drafts?.list(GHOSTTY_PULL, {
      token: TOKEN,
    });

    // The submitted root stays the published list's; the reply is a draft,
    // in its thread's position, replying to that root.
    assert.equal(drafts?.length, 1);
    assert.equal(drafts[0]?.remoteId, 5004);
    assert.equal(drafts[0]?.staged, true);
    assert.equal(drafts[0]?.replyToId, 5003);
    assert.equal(drafts[0]?.path, 'src/gtk.zig');
    assert.equal(drafts[0]?.line, 157);
  });

  it('finds the pending review behind a review the viewer already submitted', async () => {
    // GitHub's reviews connection runs oldest first: unfiltered, the first
    // node is the submitted review, and the pending one behind it is missed.
    mockGraphQL(
      graphQLRoute(
        ['ViewerLogin', () => ({ viewer: { login: 'octocat' } })],
        [
          'reviewThreads',
          () => ({
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [DRAFT_THREAD, SUBMITTED_THREAD],
                },
              },
            },
          }),
        ],
        [
          'PendingReview',
          () => ({
            repository: {
              pullRequest: {
                reviews: {
                  nodes: graphQLCalls()
                    .at(-1)
                    ?.query.includes('states: [PENDING]')
                    ? [{ id: 'PRR_node_1', databaseId: 777, state: 'PENDING' }]
                    : [
                        {
                          id: 'PRR_node_2',
                          databaseId: 778,
                          state: 'COMMENTED',
                        },
                      ],
                },
              },
            },
          }),
        ]
      )
    );
    const drafts = await githubForge.drafts?.list(GHOSTTY_PULL, {
      token: TOKEN,
    });

    assert.deepEqual(
      drafts?.map((draft) => draft.remoteId),
      [5001]
    );
  });

  it('answers an empty list when no review is pending, and asks for no threads', async () => {
    mockGraphQL(
      graphQLRoute(
        ['ViewerLogin', () => ({ viewer: { login: 'octocat' } })],
        [
          'PendingReview',
          () => ({
            repository: {
              pullRequest: {
                reviews: {
                  nodes: [
                    { id: 'PRR_node_2', databaseId: 778, state: 'COMMENTED' },
                  ],
                },
              },
            },
          }),
        ]
      )
    );
    const drafts = await githubForge.drafts?.list(GHOSTTY_PULL, {
      token: TOKEN,
    });
    assert.deepEqual(drafts, []);
    // The viewer and the lookup, and no reviewThreads read after them.
    assert.equal(graphQLCalls().length, 2);
  });

  it('answers an empty list without a token and asks nothing', async () => {
    const drafts = await githubForge.drafts?.list(GHOSTTY_PULL, {});
    assert.deepEqual(drafts, []);
    assert.equal(requests.length, 0);
  });
});

describe('drafts.create', () => {
  // The thread the mutation returns, as ADD_REVIEW_THREAD_MUTATION selects
  // it: the position lives on the thread, the text and identity on its first
  // comment.
  const DRAFT_THREAD = {
    id: 'PRRT_node_new',
    diffSide: 'RIGHT',
    startDiffSide: 'RIGHT',
    line: 10,
    startLine: 4,
    path: 'src/gtk.zig',
    comments: {
      nodes: [
        {
          databaseId: 5002,
          id: 'PRRC_node_2',
          author: { login: 'octocat', avatarUrl: null },
          body: 'A staged note.',
          createdAt: '2026-09-02T11:00:00Z',
          url: 'https://github.com/ghostty-org/ghostty/pull/14052#discussion_r5002',
        },
      ],
    },
  };

  it('opens the pending review, then adds the thread with the range fields', async () => {
    mockGraphQL(
      graphQLRoute(
        ['ViewerLogin', () => ({ viewer: { login: 'octocat' } })],
        [
          'addPullRequestReviewThread',
          () => ({
            addPullRequestReviewThread: {
              thread: DRAFT_THREAD,
            },
          }),
        ],
        [
          'addPullRequestReview(input',
          () => ({
            addPullRequestReview: {
              pullRequestReview: { id: 'PRR_node_1', databaseId: 777 },
            },
          }),
        ],
        [
          'PendingReview',
          () => ({
            repository: { pullRequest: { reviews: { nodes: [] } } },
          }),
        ],
        [
          'PullNodeId',
          () => ({ repository: { pullRequest: { id: 'PR_node_1' } } }),
        ]
      )
    );
    const payload = await githubForge.drafts?.create(
      GHOSTTY_PULL,
      {
        body: 'A staged note.',
        path: 'src/gtk.zig',
        line: 10,
        side: 'additions',
        startLine: 4,
        startSide: 'additions',
      },
      { token: TOKEN }
    );

    const calls = graphQLCalls();
    // The viewer, the pending lookup, the node id, the review, the thread.
    assert.equal(calls.length, 5);
    assert.deepEqual(calls[3].variables, { pullRequestId: 'PR_node_1' });
    assert.deepEqual(calls[4].variables, {
      input: {
        pullRequestReviewId: 'PRR_node_1',
        path: 'src/gtk.zig',
        body: 'A staged note.',
        subjectType: 'LINE',
        line: 10,
        side: 'RIGHT',
        startLine: 4,
        startSide: 'RIGHT',
      },
    });
    assert.equal(payload?.remoteId, 5002);
    assert.equal(payload?.remoteNodeId, 'PRRC_node_2');
    assert.equal(payload?.staged, true);
    assert.equal(payload?.path, 'src/gtk.zig');
    assert.equal(payload?.line, 10);
    assert.equal(payload?.side, 'additions');
    assert.equal(payload?.startLine, 4);
    assert.equal(payload?.startSide, 'additions');
  });

  it('joins the pending review that is already there', async () => {
    mockGraphQL(
      graphQLRoute(
        ['ViewerLogin', () => ({ viewer: { login: 'octocat' } })],
        [
          'addPullRequestReviewThread',
          () => ({
            addPullRequestReviewThread: {
              thread: DRAFT_THREAD,
            },
          }),
        ],
        [
          'PendingReview',
          () => ({
            repository: {
              pullRequest: {
                reviews: {
                  nodes: [
                    { id: 'PRR_node_1', databaseId: 777, state: 'PENDING' },
                  ],
                },
              },
            },
          }),
        ]
      )
    );
    await githubForge.drafts?.create(
      GHOSTTY_PULL,
      {
        body: 'A staged note.',
        path: 'src/gtk.zig',
        line: 10,
        side: 'additions',
      },
      { token: TOKEN }
    );

    const calls = graphQLCalls();
    // The viewer, the lookup, the thread — no review opened, and a single
    // line carries no start fields.
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[2].variables, {
      input: {
        pullRequestReviewId: 'PRR_node_1',
        path: 'src/gtk.zig',
        body: 'A staged note.',
        subjectType: 'LINE',
        line: 10,
        side: 'RIGHT',
      },
    });
  });

  it('refuses an anonymous caller before asking GitHub', async () => {
    await expectGitHubError(
      githubForge.drafts!.create(
        GHOSTTY_PULL,
        { body: 'A note.', path: 'src/gtk.zig', line: 3, side: 'additions' },
        {}
      ),
      { status: 401, message: { fragment: 'needs a token' } }
    );
    assert.equal(requests.length, 0);
  });
});

describe('drafts.remove', () => {
  it('deletes the comment by its GraphQL node id', async () => {
    mockGraphQL(
      graphQLRoute([
        'deletePullRequestReviewComment',
        () => ({ deletePullRequestReviewComment: { clientMutationId: null } }),
      ])
    );
    await githubForge.drafts?.remove(
      GHOSTTY_PULL,
      { nodeId: 'PRRC_node_1' },
      { token: TOKEN }
    );

    const [call] = graphQLCalls();
    assert.deepEqual(call.variables, { id: 'PRRC_node_1' });
  });

  it('refuses a delete that names no node id', async () => {
    await expectGitHubError(
      githubForge.drafts!.remove(GHOSTTY_PULL, {}, { token: TOKEN }),
      {
        status: 400,
        message: { fragment: 'no node id to delete by' },
      }
    );
    assert.equal(requests.length, 0);
  });
});

describe('viewedFiles.list', () => {
  it('paginates and keeps only the VIEWED marks', async () => {
    // Hand-shaped: GraphQL refuses an anonymous caller.
    mockGraphQL(
      graphQLRoute([
        'viewerViewedState',
        (variables) =>
          variables.after == null
            ? {
                repository: {
                  pullRequest: {
                    files: {
                      pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
                      nodes: [
                        { path: 'a.ts', viewerViewedState: 'VIEWED' },
                        { path: 'b.ts', viewerViewedState: 'DISMISSED' },
                        { path: 'c.ts', viewerViewedState: 'UNVIEWED' },
                      ],
                    },
                  },
                },
              }
            : {
                repository: {
                  pullRequest: {
                    files: {
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes: [{ path: 'd.ts', viewerViewedState: 'VIEWED' }],
                    },
                  },
                },
              },
      ])
    );
    const result = await githubForge.viewedFiles?.list(GHOSTTY_PULL, {
      token: TOKEN,
    });

    // DISMISSED is a mark about lines that are no longer there, so it reads
    // as unread.
    assert.deepEqual(result, { paths: ['a.ts', 'd.ts'] });
    const calls = graphQLCalls();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].variables.after, 'cursor-1');
  });

  it('answers an empty list without a token and asks nothing', async () => {
    const result = await githubForge.viewedFiles?.list(GHOSTTY_PULL, {});
    assert.deepEqual(result, { paths: [] });
    assert.equal(requests.length, 0);
  });
});

describe('viewedFiles.set', () => {
  it('reads the node id, then marks the file', async () => {
    mockGraphQL(
      graphQLRoute(
        // The unmark string contains the mark one, so it is routed first.
        [
          'unmarkFileAsViewed',
          () => ({ unmarkFileAsViewed: { clientMutationId: null } }),
        ],
        [
          'markFileAsViewed',
          () => ({ markFileAsViewed: { clientMutationId: null } }),
        ],
        [
          'PullNodeId',
          () => ({ repository: { pullRequest: { id: 'PR_node_1' } } }),
        ]
      )
    );
    await githubForge.viewedFiles?.set(
      GHOSTTY_PULL,
      { path: 'a.ts', viewed: true },
      { token: TOKEN }
    );

    const calls = graphQLCalls();
    assert.equal(calls.length, 2);
    assert.ok(calls[0].query.includes('PullNodeId'));
    assert.ok(calls[1].query.includes('markFileAsViewed'));
    assert.deepEqual(calls[1].variables, {
      pullRequestId: 'PR_node_1',
      path: 'a.ts',
    });
  });

  it('unmarks through the other mutation', async () => {
    mockGraphQL(
      graphQLRoute(
        [
          'unmarkFileAsViewed',
          () => ({ unmarkFileAsViewed: { clientMutationId: null } }),
        ],
        [
          'markFileAsViewed',
          () => ({ markFileAsViewed: { clientMutationId: null } }),
        ],
        [
          'PullNodeId',
          () => ({ repository: { pullRequest: { id: 'PR_node_1' } } }),
        ]
      )
    );
    await githubForge.viewedFiles?.set(
      GHOSTTY_PULL,
      { path: 'a.ts', viewed: false },
      { token: TOKEN }
    );

    const calls = graphQLCalls();
    assert.ok(calls[1].query.includes('unmarkFileAsViewed'));
    assert.deepEqual(calls[1].variables, {
      pullRequestId: 'PR_node_1',
      path: 'a.ts',
    });
  });

  it('turns a missing pull request into a 404', async () => {
    mockGraphQL(
      graphQLRoute([
        'PullNodeId',
        () => ({ repository: { pullRequest: null } }),
      ])
    );
    await expectGitHubError(
      githubForge.viewedFiles!.set(
        GHOSTTY_PULL,
        { path: 'a.ts', viewed: true },
        { token: TOKEN }
      ),
      { status: 404, message: 'Not Found' }
    );
  });
});

describe('error mapping', () => {
  it('reads a 403 with retry-after as a spent quota', async () => {
    mockGetPull(
      'ghostty-org',
      'ghostty',
      14052,
      { message: 'API rate limit exceeded for you.' },
      { status: 403, headers: { 'retry-after': '30' } }
    );
    await expectGitHubError(
      githubForge.pullDetails(GHOSTTY_PULL, { token: TOKEN }),
      { status: 429, message: 'API rate limit exceeded for you.' }
    );
  });

  it('reads a 403 with an empty rate-limit budget as a spent quota', async () => {
    mockGetPull(
      'ghostty-org',
      'ghostty',
      14052,
      { message: 'API rate limit exceeded for you.' },
      { status: 403, headers: { 'x-ratelimit-remaining': '0' } }
    );
    await expectGitHubError(
      githubForge.pullDetails(GHOSTTY_PULL, { token: TOKEN }),
      { status: 429, message: 'API rate limit exceeded for you.' }
    );
  });

  it('keeps a plain 403 as 403', async () => {
    mockGetPull(
      'ghostty-org',
      'ghostty',
      14052,
      { message: 'Forbidden' },
      { status: 403 }
    );
    await expectGitHubError(
      githubForge.pullDetails(GHOSTTY_PULL, { token: TOKEN }),
      { status: 403, message: 'Forbidden' }
    );
  });
});

describe('diff', () => {
  it('streams the web host’s diff when it answers', async () => {
    mockWebDiff('/GalvinGao/ghdiff/pull/13', { body: DIFF_TEXT });
    const response = await callDiff(githubForge, GHDIFF_PULL_13_TARGET, {});

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/plain');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), DIFF_TEXT);

    const [web] = requestsTo(GITHUB_WEB, '/GalvinGao/ghdiff/pull/13.diff');
    assertGitHubHeaders(web);
    assert.equal(requestsTo(GITHUB_API).length, 0);
  });

  it('answers from the API when the web host 404s', async () => {
    mockWebDiff('/GalvinGao/ghdiff/pull/13', {
      status: 404,
      body: 'Not Found',
    });
    mockPullDiff('GalvinGao', 'ghdiff', 13, DIFF_TEXT);
    const response = await callDiff(githubForge, GHDIFF_PULL_13_TARGET, {
      token: TOKEN,
    });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), DIFF_TEXT);

    const [web] = requestsTo(GITHUB_WEB);
    assertGitHubHeaders(web, { token: TOKEN });
    const [api] = requestsTo(GITHUB_API, '/repos/GalvinGao/ghdiff/pulls/13');
    assert.equal(api.headers.accept, 'application/vnd.github.diff');
    assertGitHubHeaders(api, { token: TOKEN });
  });

  it('stitches the file list into a patch when both diff views refuse', async () => {
    mockWebDiff('/GalvinGao/ghdiff/pull/6', { status: 404, body: 'Not Found' });
    // Hand-shaped: the recorded 406 sentence, per github/patch.ts. A pull
    // request over 300 files or 20000 lines hears this from the diff media
    // type.
    mockPullDiff(
      'GalvinGao',
      'ghdiff',
      6,
      JSON.stringify({
        message:
          'Sorry, the diff exceeded the maximum number of lines (20000).',
      }),
      { status: 406 }
    );
    mockPullFiles('GalvinGao', 'ghdiff', 6, { 1: { body: FILES } });
    const response = await callDiff(githubForge, GHDIFF_PULL_6_TARGET, {
      token: TOKEN,
    });

    const patch = await response.text();
    assert.ok(patch.startsWith('diff --git a/AGENTS.md b/AGENTS.md'));
    assert.ok(patch.includes('diff --git a/src/hooks/preferences.ts'));
    // Every recorded file carried its hunks, so the notice stays off.
    assert.equal(response.headers.get('x-ghdiff-notice'), null);

    const [files] = requestsTo(
      GITHUB_API,
      '/repos/GalvinGao/ghdiff/pulls/6/files'
    );
    assertGitHubHeaders(files, { token: TOKEN });
  });

  it('stitches a compare range’s files the same way', async () => {
    const target: GitHubTarget = {
      kind: 'github-compare',
      owner: 'GalvinGao',
      repo: 'ghdiff',
      base: '3756360521e239afdc7145f36ef20d204f5204cf',
      head: '9054b5d751e6ad9ae2b09e3ff759d51c8aad3b91',
    };
    mockWebDiff(
      '/GalvinGao/ghdiff/compare/3756360521e239afdc7145f36ef20d204f5204cf...9054b5d751e6ad9ae2b09e3ff759d51c8aad3b91',
      { status: 404, body: 'Not Found' }
    );
    mockCompareEndpoint('GalvinGao', 'ghdiff', {
      diff: {
        body: JSON.stringify({
          message:
            'Sorry, the diff exceeded the maximum number of lines (20000).',
        }),
        status: 406,
      },
      json: { body: COMPARE },
    });
    const response = await callDiff(githubForge, target, {});

    const patch = await response.text();
    assert.ok(
      patch.startsWith(
        'diff --git a/src/components/ReviewHeader.tsx b/src/components/ReviewHeader.tsx'
      )
    );
  });

  it('reports the API’s sentence when every source fails', async () => {
    mockWebDiff('/GalvinGao/ghdiff/pull/13', {
      status: 404,
      body: 'web says no',
    });
    mockPullDiff(
      'GalvinGao',
      'ghdiff',
      13,
      JSON.stringify({ message: 'API says the repository is gone.' }),
      { status: 404 }
    );
    mockPullFiles('GalvinGao', 'ghdiff', 13, {
      1: { body: { message: 'files say no' }, status: 404 },
    });

    // The web host's 404 covers "absent" and "not permitted" alike, so the
    // API's sentence is the one worth reporting.
    await expectGitHubError(
      callDiff(githubForge, GHDIFF_PULL_13_TARGET, { token: TOKEN }),
      {
        status: 404,
        message: 'API says the repository is gone.',
      }
    );
  });
});

describe('file', () => {
  const PULL_99_TARGET: GitHubTarget = {
    kind: 'github-pull',
    owner: 'ghostty-org',
    repo: 'ghostty',
    number: 99,
  };

  it('reads the raw host at the pull ref when there is no token', async () => {
    mockWebRaw('ghostty-org', 'ghostty', 'pub fn main() void {}\n');
    const response = await githubForge.file(PULL_99_TARGET, 'src/main.zig', {});

    assert.equal(await response.text(), 'pub fn main() void {}\n');
    const [call] = requests;
    assert.equal(
      call.path,
      '/ghostty-org/ghostty/refs/pull/99/head/src/main.zig'
    );
    assertGitHubHeaders(call);
    assert.equal(requestsTo(GITHUB_API).length, 0);
  });

  it('reads the contents API with a token', async () => {
    mockContents('ghostty-org', 'ghostty', 'pub fn main() void {}\n');
    const response = await githubForge.file(PULL_99_TARGET, 'src/main.zig', {
      token: TOKEN,
    });

    assert.equal(await response.text(), 'pub fn main() void {}\n');
    const [call] = requests;
    assert.equal(call.path, '/repos/ghostty-org/ghostty/contents/src/main.zig');
    assert.equal(call.query.ref, 'refs/pull/99/head');
    assert.equal(call.headers.accept, 'application/vnd.github.raw');
    assertGitHubHeaders(call, { token: TOKEN });
  });
});

describe('media', () => {
  const WEB_ROOT = `https://${GITHUB_WEB}`;
  const RAW_ROOT = `https://${GITHUB_RAW}`;
  const PRIVATE_IMAGES = 'https://private-user-images.githubusercontent.com';
  const ASSETS = '/ghostty-org/ghostty/assets/123/abc.png';
  const PNG_HEADERS = { 'content-type': 'image/png' };

  it('fetches an attachment with the credential', async () => {
    mockImageHost(WEB_ROOT, ASSETS, 'png-bytes', { headers: PNG_HEADERS });
    const response = await githubForge.media?.(
      GHDIFF_PULL_13_TARGET,
      `https://github.com${ASSETS}`,
      { token: TOKEN }
    );

    assert.ok(response != null);
    assert.equal(await response.text(), 'png-bytes');
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, ASSETS);
    assertGitHubHeaders(requests[0], { token: TOKEN });
  });

  it('fetches a raw file address', async () => {
    mockImageHost(
      RAW_ROOT,
      '/ghostty-org/ghostty/main/doc/figure.png',
      'png-bytes',
      { headers: PNG_HEADERS }
    );
    const response = await githubForge.media?.(
      GHDIFF_PULL_13_TARGET,
      'https://raw.githubusercontent.com/ghostty-org/ghostty/main/doc/figure.png',
      {}
    );

    assert.ok(response != null);
    assert.equal(await response.text(), 'png-bytes');
    assertGitHubHeaders(requests[0]);
  });

  it('refuses a github.com address that is no attachment', async () => {
    await expectGitHubError(
      githubForge.media?.(
        GHDIFF_PULL_13_TARGET,
        'https://github.com/ghostty-org/ghostty/blob/main/doc/figure.png',
        {}
      ) ?? Promise.reject(new Error('no media')),
      { status: 400, message: { fragment: 'not GitHub-hosted' } }
    );
    assert.equal(requests.length, 0);
  });

  it('refuses an address on any other host without fetching it', async () => {
    await expectGitHubError(
      githubForge.media?.(
        GHDIFF_PULL_13_TARGET,
        'https://elsewhere.com/image.png',
        { token: TOKEN }
      ) ?? Promise.reject(new Error('no media')),
      { status: 400, message: { fragment: 'not GitHub-hosted' } }
    );
    assert.equal(requests.length, 0);
  });

  it('refuses a plaintext address on the right host without fetching it', async () => {
    // Both GitHub hosts are HTTPS-only, and the first hop carries the
    // credential: an http: address is refused before any fetch is made.
    await expectGitHubError(
      githubForge.media?.(GHDIFF_PULL_13_TARGET, `http://github.com${ASSETS}`, {
        token: TOKEN,
      }) ?? Promise.reject(new Error('no media')),
      { status: 400, message: { fragment: 'not valid' } }
    );
    assert.equal(requests.length, 0);
  });

  it('follows the signed redirect off the web host, leaving the credential behind', async () => {
    // An attachment answers with a redirect to the signed image host; the
    // token is github.com's own and the signed URL wants none.
    mockImageHost(WEB_ROOT, ASSETS, '', {
      status: 302,
      headers: { location: `${PRIVATE_IMAGES}/jwt-signed/x.png` },
    });
    mockImageHost(PRIVATE_IMAGES, '/jwt-signed/x.png', 'png-bytes', {
      headers: PNG_HEADERS,
    });
    const response = await githubForge.media?.(
      GHDIFF_PULL_13_TARGET,
      `https://github.com${ASSETS}`,
      { token: TOKEN }
    );

    assert.ok(response != null);
    assert.equal(await response.text(), 'png-bytes');
    assert.equal(requests.length, 2);
    assertGitHubHeaders(requests[1]);
  });
});

describe('reviews.team', () => {
  it('lists the newest verdicts other people gave', async () => {
    mockGraphQL(
      graphQLRoute([
        'TeamReviews',
        () => ({
          repository: {
            pullRequest: {
              reviews: {
                nodes: [
                  {
                    databaseId: 1,
                    state: 'APPROVED',
                    submittedAt: '2026-10-01T00:00:00Z',
                    bodyText: '',
                    viewerDidAuthor: false,
                    author: { kind: 'User', login: 'alice' },
                    comments: { totalCount: 0 },
                  },
                  {
                    databaseId: 2,
                    state: 'APPROVED',
                    viewerDidAuthor: true,
                    author: { kind: 'User', login: 'me' },
                  },
                  {
                    databaseId: 3,
                    state: 'CHANGES_REQUESTED',
                    submittedAt: '2026-10-02T00:00:00Z',
                    bodyText: 'Not yet',
                    viewerDidAuthor: false,
                    author: { kind: 'Bot', login: 'lint' },
                  },
                ],
              },
            },
          },
        }),
      ])
    );
    const reviews = await githubForge.reviews.team?.(GHOSTTY_PULL, {
      token: TOKEN,
    });
    assert.deepEqual(
      reviews?.map((review) => [review.author, review.state]),
      [['alice', 'APPROVED']]
    );
    const [call] = graphQLCalls();
    assert.equal(call.variables.number, 14052);
  });
});

describe('comments.conversation', () => {
  it('interleaves the remarks and the verdicts, oldest first', async () => {
    mockIssueComments('ghostty-org', 'ghostty', 14052, [
      {
        id: 10,
        body: 'Second',
        created_at: '2026-10-02T00:00:00Z',
        user: { login: 'bob', type: 'User' },
      },
    ]);
    mockPullReviews('ghostty-org', 'ghostty', 14052, [
      {
        id: 20,
        state: 'APPROVED',
        body: '',
        submitted_at: '2026-10-01T00:00:00Z',
        user: { login: 'alice', type: 'User' },
      },
      {
        id: 21,
        state: 'COMMENTED',
        body: '',
        submitted_at: '2026-10-03T00:00:00Z',
        user: { login: 'carol', type: 'User' },
      },
    ]);
    const entries = await githubForge.comments.conversation?.(GHOSTTY_PULL, {
      token: TOKEN,
    });
    assert.deepEqual(
      entries?.map((entry) => entry.key),
      ['review-20', 'comment-10']
    );
    for (const call of requestsTo('api.github.com')) {
      assert.equal(call.headers.accept, 'application/vnd.github.v3.full');
    }
  });
});

describe('issues.create', () => {
  const HEAD = 'b'.repeat(40);

  it('files the note with a permalink at the pull request head', async () => {
    mockGetPull('GalvinGao', 'ghdiff', 13, {
      head: { sha: HEAD },
      base: { sha: 'a'.repeat(40) },
    });
    mockCreateIssue('GalvinGao', 'ghdiff', {
      number: 99,
      html_url: 'https://github.com/GalvinGao/ghdiff/issues/99',
    });
    const issue = await githubForge.issues?.create(
      GHDIFF_PULL_13_TARGET,
      { text: 'Follow this up', path: 'src/a.ts', line: 4, side: 'additions' },
      { token: TOKEN }
    );
    assert.equal(issue?.number, 99);
    const [post] = requests.filter((call) => call.method === 'POST');
    const body = post?.body as { title: string; body: string };
    assert.equal(body.title, 'Follow this up');
    assert.ok(body.body.includes(`/blob/${HEAD}/src/a.ts#L4`));
  });

  it('names the missing permission on a 403', async () => {
    mockGetPull('GalvinGao', 'ghdiff', 13, {
      head: { sha: HEAD },
      base: { sha: 'a'.repeat(40) },
    });
    mockCreateIssue(
      'GalvinGao',
      'ghdiff',
      { message: 'Resource not accessible by integration' },
      { status: 403 }
    );
    await expectGitHubError(
      Promise.resolve(
        githubForge.issues?.create(
          GHDIFF_PULL_13_TARGET,
          { text: 'x', path: 'a', line: 1, side: 'additions' },
          { token: TOKEN }
        )
      ),
      { status: 403, message: { fragment: 'Issues permission' } }
    );
  });
});

describe('deployments', () => {
  it('reads the pull request commits and their deployments', async () => {
    const head = 'c'.repeat(40);
    mockGraphQL(
      graphQLRoute([
        'DeploymentsOfPull',
        () => ({
          repository: {
            pullRequest: {
              headRefName: 'feature',
              headRefOid: head,
              commits: {
                nodes: [
                  {
                    commit: {
                      oid: head,
                      statusCheckRollup: { state: 'SUCCESS' },
                      deployments: {
                        nodes: [
                          {
                            databaseId: 5,
                            environment: 'Preview',
                            createdAt: new Date().toISOString(),
                            state: 'ACTIVE',
                            latestStatus: {
                              state: 'SUCCESS',
                              environmentUrl: 'https://preview.example.com',
                            },
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        }),
      ])
    );
    const data = await githubForge.deployments?.(GHDIFF_PULL_13_TARGET, {
      token: TOKEN,
    });
    assert.equal(data?.headSha, head);
    assert.equal(data?.headChecks, 'success');
    assert.deepEqual(
      data?.deployments.map((row) => [row.environment, row.state]),
      [['Preview', 'success']]
    );
  });

  it('reads a personal access token refusal as nothing deployed', async () => {
    mockGraphQL(() =>
      graphQLErrors('Resource not accessible by personal access token')
    );
    const data = await githubForge.deployments?.(GHDIFF_PULL_13_TARGET, {
      token: TOKEN,
    });
    assert.deepEqual(data?.deployments, []);
  });

  it('reads a refused permission as nothing deployed', async () => {
    mockGraphQL(() => graphQLErrors('Resource not accessible by integration'));
    const data = await githubForge.deployments?.(GHDIFF_PULL_13_TARGET, {
      token: TOKEN,
    });
    assert.deepEqual(data?.deployments, []);
  });
});
