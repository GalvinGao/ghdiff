import { MARKED } from '@test/e2e/lib/util';
import assert from 'node:assert/strict';
// The features upstream added after the fork point, against the live forge:
// the team's verdicts, the conversation, an issue filed from a note, the
// deployments menu, the conditional patch and file reads, a GraphQL refusal's
// status, and the local target the hosted routes turn away.
import { afterAll, beforeAll, test } from 'vitest';

import {
  gh,
  gql,
  MARK,
  OWNER,
  paginate,
  raw,
  ref,
  REPO,
  rpc,
  VIEWER,
} from './helpers';
import type { CreatedIssue } from '@/lib/commentIssue';
import type { DeploymentsData } from '@/lib/deployments';
import type { ConversationEntry } from '@/lib/pullConversation';
import type { PullDetails } from '@/lib/pullDetails';
import type { TeamReview } from '@/lib/reviewDecision';

const PULL_1 = {
  kind: 'github-pull',
  owner: OWNER,
  repo: REPO,
  number: 1,
} as const;

interface GhIssue {
  number: number;
  node_id: string;
  title: string;
  body?: string;
  state: string;
  pull_request?: unknown;
}

/**
 * Takes every issue this suite ever filed out of the fixture: deleted where
 * the token may (an admin's), closed where it may not. Matched by the marker
 * at the head of the title, so a human's issue is never touched.
 */
async function removeMarkedIssues(): Promise<void> {
  // Every page is read before the first delete, so nothing shifts between
  // pages under the walk.
  const issues = await paginate<GhIssue>('/issues?state=all');
  for (const issue of issues) {
    if (issue.pull_request != null || !MARKED.test(issue.title)) continue;
    try {
      await gql(
        'mutation($id:ID!){ deleteIssue(input:{issueId:$id}){ clientMutationId } }',
        {
          id: issue.node_id,
        }
      );
    } catch {
      if (issue.state !== 'closed') {
        await gh('PATCH', `/issues/${issue.number}`, { state: 'closed' });
      }
    }
  }
}

beforeAll(removeMarkedIssues);
afterAll(removeMarkedIssues);

test('reviews.team answers the newest verdicts, never the viewer’s own', async () => {
  const r = await rpc<{ reviews: TeamReview[] }>('reviews/team', ref(1));
  assert.ok(r.ok, r.raw);
  assert.ok(Array.isArray(r.json.reviews));
  assert.ok(r.json.reviews.length <= 5);
  for (const review of r.json.reviews) {
    assert.notEqual(review.author.toLowerCase(), VIEWER.login.toLowerCase());
    assert.ok(
      ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'].includes(review.state)
    );
    assert.equal(typeof review.id, 'number');
  }
});

test('comments.conversation reads a remark under the description, oldest first', async () => {
  const body = `${MARK} conversation remark`;
  const posted = await gh<{ id: number }>('POST', '/issues/1/comments', {
    body,
  });
  try {
    const r = await rpc<ConversationEntry[]>('comments/conversation', ref(1));
    assert.ok(r.ok, r.raw);
    const entry = r.json.find((e) => e.key === `comment-${posted.id}`);
    assert.ok(entry != null, 'the remark is not in the conversation');
    assert.equal(entry.kind, 'comment');
    assert.equal(entry.body, body);
    assert.equal(entry.author.toLowerCase(), VIEWER.login.toLowerCase());
    // Oldest first, the way github.com reads.
    const times = r.json
      .map((e) => (e.createdAt == null ? Number.NaN : Date.parse(e.createdAt)))
      .filter((t) => !Number.isNaN(t));
    assert.deepEqual(
      times,
      [...times].sort((a, b) => a - b)
    );
  } finally {
    await gh('DELETE', `/issues/comments/${posted.id}`);
  }
});

test('issues.create files the note with a full-sha permalink to the lines', async () => {
  const details = await rpc<PullDetails>('pulls/get', ref(1));
  assert.ok(details.ok, details.raw);
  const r = await rpc<CreatedIssue>('issues/create', {
    target: PULL_1,
    text: `${MARK} follow up on the entry point`,
    path: 'src/index.ts',
    line: 3,
    startLine: 1,
    side: 'additions',
  });
  assert.ok(r.ok, r.raw);
  assert.equal(typeof r.json.number, 'number');
  assert.match(
    r.json.htmlUrl,
    new RegExp(`/${OWNER}/${REPO}/issues/${r.json.number}$`)
  );

  const issue = await gh<GhIssue>('GET', `/issues/${r.json.number}`);
  assert.ok(issue.title.startsWith(MARK));
  assert.match(
    issue.body ?? '',
    new RegExp(`/${OWNER}/${REPO}/blob/[0-9a-f]{40}/src/index\\.ts#L1-L3`)
  );
  assert.match(issue.body ?? '', /\/pull\/1/);
});

test('issues.create refuses an anonymous caller', async () => {
  const r = await rpc(
    'issues/create',
    {
      target: PULL_1,
      text: `${MARK} anonymous`,
      path: 'src/index.ts',
      line: 1,
      side: 'additions',
    },
    { auth: 'none' }
  );
  assert.equal(r.status, 401, r.raw);
});

test('deployments.list answers for the pull request, empty when GitHub refuses', async () => {
  const r = await rpc<DeploymentsData>('deployments/list', {
    target: PULL_1,
  });
  // A token GitHub will not show deployments to reads as nothing deployed,
  // never as a failure.
  assert.ok(r.ok, r.raw);
  assert.ok(Array.isArray(r.json.deployments));
  if (r.json.headSha != null) assert.match(r.json.headSha, /^[0-9a-f]{40}$/);
});

test('/api/diff answers 304 to the ETag it gave', async () => {
  const path = `/api/diff?kind=github-pull&owner=${OWNER}&repo=${REPO}&number=1`;
  const first = await raw(path);
  assert.equal(first.status, 200, first.text.slice(0, 200));
  const etag = first.headers.get('etag');
  assert.ok(etag != null, 'no ETag on the patch');

  const again = await raw(path, { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304);
  assert.equal(again.text, '');
});

test('/api/file answers 304 to the ETag it gave', async () => {
  const path = `/api/file?kind=github-pull&owner=${OWNER}&repo=${REPO}&number=1&path=src/index.ts`;
  const first = await raw(path);
  assert.equal(first.status, 200, first.text.slice(0, 200));
  const etag = first.headers.get('etag');
  assert.ok(etag != null, 'no ETag on the file');

  const again = await raw(path, { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304);
  assert.equal(again.text, '');
});

test('a GraphQL refusal surfaces as BAD_GATEWAY with GitHub’s sentence', async () => {
  const r = await rpc('reviews/mine', {
    forge: 'github',
    owner: OWNER,
    repo: 'ghdiff-e2e-no-such-repo',
    number: 1,
  });
  assert.equal(r.status, 502, r.raw);
  assert.match(r.raw, /Could not resolve to a Repository/);
});

test('the hosted routes turn a local target away with 400', async () => {
  const query = 'kind=local-diff&root=%2Ftmp%2Frepo&mode=worktree';
  const d = await raw(`/api/diff?${query}`);
  assert.equal(d.status, 400, d.text);
  const f = await raw(`/api/file?${query}&path=a.txt`);
  assert.equal(f.status, 400, f.text);
});
