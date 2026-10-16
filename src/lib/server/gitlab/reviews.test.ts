import {
  assertGitLabHeaders,
  GITLAB_CORP,
  mockApprovals,
  mockGetUser,
  mockMrNotes,
  mockMrReviewers,
} from '@test/msw/gitlab';
import { requestsTo, resetMocks, server } from '@test/msw/shared';
import assert from 'node:assert/strict';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

import { readConversation, readTeamReviews } from './reviews';
import { MAX_TEAM_REVIEWS } from '@/lib/reviewDecision';

// The team's verdicts and the history's, read off a merge request on a
// self-hosted instance. The answers are hand-shaped in the fields GitLab
// sends: the reviewers and approvals endpoints answer anonymously on
// gitlab.com, but the viewer and the notes do not.

const PROJECT = 'team/app';
const WEB_URL = `https://${GITLAB_CORP}/team/app/-/merge_requests/7`;
const CRED = { token: 'glpat-x', scheme: 'private-token' as const };

function user(id: number, username: string, bot = false) {
  return { id, username, avatar_url: `https://a/${username}.png`, bot };
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

describe('readTeamReviews', () => {
  it('lists reviewers with a decision, then approvers nobody asked', async () => {
    mockGetUser(GITLAB_CORP, { body: user(1, 'me') });
    mockMrReviewers(GITLAB_CORP, {
      body: [
        {
          // When the review was asked for, not when it was given.
          user: user(2, 'older'),
          state: 'requested_changes',
          created_at: '2026-10-01T00:00:00Z',
        },
        {
          user: user(3, 'newer'),
          state: 'approved',
          created_at: '2026-10-02T00:00:00Z',
        },
        { user: user(4, 'waiting'), state: 'unreviewed' },
        { user: user(1, 'me'), state: 'approved' },
        { user: user(5, 'renovate-bot'), state: 'reviewed' },
      ],
    });
    mockApprovals(GITLAB_CORP, {
      7: {
        body: {
          approved_by: [
            { user: user(3, 'newer') },
            { user: user(6, 'drive-by') },
            { user: user(7, 'ci', true) },
          ],
        },
      },
    });

    const reviews = await readTeamReviews(
      GITLAB_CORP,
      PROJECT,
      7,
      CRED,
      WEB_URL
    );

    assert.deepEqual(
      reviews.map((review) => [review.author, review.state]),
      [
        ['older', 'CHANGES_REQUESTED'],
        ['newer', 'APPROVED'],
        ['drive-by', 'APPROVED'],
      ]
    );
    assert.equal(reviews[0]?.htmlUrl, WEB_URL);
    assert.ok(reviews.every((review) => review.submittedAt == null));
    const calls = requestsTo(GITLAB_CORP);
    assert.ok(
      calls.some((call) =>
        call.path.endsWith('/projects/team%2Fapp/merge_requests/7/reviewers')
      )
    );
    for (const call of calls) {
      assertGitLabHeaders(call, { scheme: 'private-token', token: 'glpat-x' });
    }
  });

  it('still answers from the approvals on an instance without reviewer states', async () => {
    mockGetUser(GITLAB_CORP, { body: user(1, 'me') });
    mockMrReviewers(GITLAB_CORP, { status: 404, body: { message: '404' } });
    mockApprovals(GITLAB_CORP, {
      7: { body: { approved_by: [{ user: user(2, 'approver') }] } },
    });

    const reviews = await readTeamReviews(
      GITLAB_CORP,
      PROJECT,
      7,
      CRED,
      WEB_URL
    );

    assert.deepEqual(
      reviews.map((review) => review.author),
      ['approver']
    );
  });

  it('keeps only the newest few', async () => {
    mockGetUser(GITLAB_CORP, { body: user(1, 'me') });
    mockMrReviewers(GITLAB_CORP, { body: [] });
    mockApprovals(GITLAB_CORP, {
      7: {
        body: {
          approved_by: Array.from({ length: MAX_TEAM_REVIEWS + 3 }, (_, i) => ({
            user: user(10 + i, `approver${i}`),
          })),
        },
      },
    });

    const reviews = await readTeamReviews(
      GITLAB_CORP,
      PROJECT,
      7,
      CRED,
      WEB_URL
    );

    assert.equal(reviews.length, MAX_TEAM_REVIEWS);
  });
});

describe('readConversation', () => {
  it('reads the verdicts out of the newest notes, oldest first, and nothing else', async () => {
    mockMrNotes(GITLAB_CORP, {
      // GitLab answers `sort=desc` newest first.
      body: [
        {
          id: 13,
          body: 'requested changes',
          system: true,
          author: user(4, 'review-bot'),
        },
        {
          id: 12,
          body: 'approved this merge request',
          system: false,
          author: user(3, 'quoting'),
        },
        {
          id: 11,
          body: 'added 1 commit',
          system: true,
          author: user(2, 'alice'),
        },
        {
          id: 10,
          body: 'approved this merge request',
          system: true,
          created_at: '2026-10-01T00:00:00Z',
          author: user(2, 'alice'),
        },
      ],
    });

    const entries = await readConversation(
      GITLAB_CORP,
      PROJECT,
      7,
      CRED,
      WEB_URL
    );

    assert.deepEqual(
      entries.map((entry) => [entry.author, entry.state, entry.authorIsBot]),
      [
        ['alice', 'APPROVED', false],
        ['review-bot', 'CHANGES_REQUESTED', true],
      ]
    );
    assert.equal(entries[0]?.htmlUrl, `${WEB_URL}#note_10`);
    const [call] = requestsTo(GITLAB_CORP);
    assert.equal(call?.query.sort, 'desc');
  });
});
