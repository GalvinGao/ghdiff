import {
  GITLAB_CORP,
  mockCommitShow,
  mockIssueCreate,
  mockMergeBase,
  mockMrShow,
} from '@test/msw/gitlab';
import {
  expectGitHubError,
  requestsTo,
  resetMocks,
  server,
} from '@test/msw/shared';
import assert from 'node:assert/strict';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

import { createGitLabIssue, resolveGitLabSideCommit } from './issue';
import type { GitLabTarget } from '@/lib/reviewTarget';

// An issue filed from a line note: which commit each side of each target was
// read at, and what the issue that comes out of it links to.

const CRED = { token: 'oauth', scheme: 'bearer' as const };
const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

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
const COMPARE: GitLabTarget = {
  kind: 'gitlab-compare',
  host: GITLAB_CORP,
  project: 'team/app',
  base: 'main',
  head: 'feature',
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

describe('resolveGitLabSideCommit', () => {
  it('reads a merge request side off its diff refs', async () => {
    mockMrShow(GITLAB_CORP, {
      body: { diff_refs: { base_sha: BASE, head_sha: HEAD } },
    });
    assert.equal(await resolveGitLabSideCommit(MR, 'additions', CRED), HEAD);
    assert.equal(await resolveGitLabSideCommit(MR, 'deletions', CRED), BASE);
  });

  it('reads a commit old side as its first parent', async () => {
    mockCommitShow(GITLAB_CORP, { body: { id: HEAD, parent_ids: [BASE] } });
    assert.equal(
      await resolveGitLabSideCommit(COMMIT, 'additions', CRED),
      HEAD
    );
    assert.equal(
      await resolveGitLabSideCommit(COMMIT, 'deletions', CRED),
      BASE
    );
  });

  it('refuses the old side of a root commit', async () => {
    mockCommitShow(GITLAB_CORP, { body: { id: HEAD, parent_ids: [] } });
    await expectGitHubError(
      resolveGitLabSideCommit(COMMIT, 'deletions', CRED),
      { status: 422, message: { fragment: 'no parent' } }
    );
  });

  it('reads a compare old side as the merge base of both refs', async () => {
    mockMergeBase(GITLAB_CORP, { body: { id: BASE } });
    assert.equal(
      await resolveGitLabSideCommit(COMPARE, 'deletions', CRED),
      BASE
    );
    const [call] = requestsTo(GITLAB_CORP);
    assert.equal(
      call?.url.includes('refs%5B%5D=main&refs%5B%5D=feature'),
      true
    );
  });
});

describe('createGitLabIssue', () => {
  it('files the note with a permalink at the side it was read on', async () => {
    mockMrShow(GITLAB_CORP, {
      body: { diff_refs: { base_sha: BASE, head_sha: HEAD } },
    });
    mockIssueCreate(GITLAB_CORP, {
      body: { iid: 42, web_url: `https://${GITLAB_CORP}/team/app/-/issues/42` },
    });

    const issue = await createGitLabIssue(
      MR,
      {
        text: 'Handle the empty case',
        path: 'src/a.ts',
        line: 12,
        startLine: 10,
        side: 'additions',
      },
      CRED
    );

    assert.equal(issue.number, 42);
    const [post] = requestsTo(
      GITLAB_CORP,
      '/api/v4/projects/team%2Fapp/issues'
    );
    const body = post?.body as { title: string; description: string };
    assert.equal(body.title, 'Handle the empty case');
    assert.ok(
      body.description.includes(`/team/app/-/blob/${HEAD}/src/a.ts#L10-12`)
    );
    assert.ok(body.description.includes('/-/merge_requests/7'));
  });
});
