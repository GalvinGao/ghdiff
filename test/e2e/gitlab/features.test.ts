import { MARKED } from '@test/e2e/lib/util';
import assert from 'node:assert/strict';
// The features upstream added after the fork point, as GitLab answers them:
// the team's verdicts, the verdicts in the conversation, an issue filed from a
// note, the deployments menu, the conditional patch and file reads, the
// 180-day session, and the local target the hosted routes turn away.
import { afterAll, beforeAll, test } from 'vitest';

import {
  gl,
  glAll,
  type GlApprovals,
  HOST,
  MARK,
  ORIGIN,
  PROJECT,
  raw,
  ref,
  rpc,
  TOKEN,
  VIEWER,
} from './helpers';
import type { CreatedIssue } from '@/lib/commentIssue';
import type { DeploymentsData } from '@/lib/deployments';
import type { ConversationEntry } from '@/lib/pullConversation';
import type { TeamReview } from '@/lib/reviewDecision';

const P = encodeURIComponent(PROJECT);
const MR_1 = { kind: 'gitlab-mr', host: HOST, project: PROJECT, number: 1 };

interface GlIssue {
  iid: number;
  title: string;
  description?: string | null;
}

/** Deletes every issue this suite ever filed, matched by its title's marker. */
async function removeMarkedIssues(): Promise<void> {
  const issues = await glAll<GlIssue>('/issues?search=e2e&in=title');
  for (const issue of issues) {
    if (MARKED.test(issue.title)) {
      await gl('DELETE', `/issues/${issue.iid}`);
    }
  }
}

async function unapprove(mr: number): Promise<void> {
  const approvals = await gl<GlApprovals>(
    'GET',
    `/merge_requests/${mr}/approvals`
  );
  if (
    approvals.approved_by?.some((a) => a.user?.username === VIEWER.username)
  ) {
    await gl('POST', `/merge_requests/${mr}/unapprove`);
  }
}

beforeAll(removeMarkedIssues);
afterAll(async () => {
  await removeMarkedIssues();
  await unapprove(2);
});

test('reviews.team leaves the viewer’s own approval out', async () => {
  await gl('POST', '/merge_requests/2/approve');
  try {
    const r = await rpc<{ reviews: TeamReview[] }>('reviews/team', ref(2));
    assert.ok(r.ok, r.raw);
    assert.ok(Array.isArray(r.json.reviews));
    for (const review of r.json.reviews) {
      assert.notEqual(
        review.author.toLowerCase(),
        VIEWER.username.toLowerCase()
      );
      // GitLab says nothing of when a verdict was given, so no age is made up.
      assert.equal(review.submittedAt, undefined);
    }
  } finally {
    await unapprove(2);
  }
});

test('comments.conversation reads an approval out of the history', async () => {
  await gl('POST', '/merge_requests/2/approve');
  try {
    const r = await rpc<ConversationEntry[]>('comments/conversation', ref(2));
    assert.ok(r.ok, r.raw);
    const mine = r.json.filter(
      (e) =>
        e.state === 'APPROVED' &&
        e.author.toLowerCase() === VIEWER.username.toLowerCase()
    );
    assert.ok(mine.length > 0, 'the approval note is not in the conversation');
    const last = mine.at(-1);
    assert.equal(last?.kind, 'review');
    assert.match(last?.htmlUrl ?? '', /#note_\d+$/);
    // Oldest first, and nothing but verdicts.
    for (const entry of r.json) assert.equal(entry.kind, 'review');
    const times = r.json
      .map((e) => (e.createdAt == null ? Number.NaN : Date.parse(e.createdAt)))
      .filter((t) => !Number.isNaN(t));
    assert.deepEqual(
      times,
      [...times].sort((a, b) => a - b)
    );
  } finally {
    await unapprove(2);
  }
});

test('issues.create files the note with a full-sha permalink to the lines', async () => {
  const r = await rpc<CreatedIssue>('issues/create', {
    target: MR_1,
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
    // gitlab.com answers an issue's address as a work item now.
    new RegExp(`/${PROJECT}/-/(issues|work_items)/${r.json.number}$`)
  );

  const issue = await gl<GlIssue>('GET', `/issues/${r.json.number}`);
  assert.ok(issue.title.startsWith(MARK));
  assert.match(
    issue.description ?? '',
    new RegExp(`/${PROJECT}/-/blob/[0-9a-f]{40}/src/index\\.ts#L1-3`)
  );
  assert.match(issue.description ?? '', /\/-\/merge_requests\/1/);
});

test('issues.create refuses an anonymous caller', async () => {
  const r = await rpc(
    'issues/create',
    {
      target: MR_1,
      text: `${MARK} anonymous`,
      path: 'src/index.ts',
      line: 1,
      side: 'additions',
    },
    { auth: 'none' }
  );
  assert.equal(r.status, 401, r.raw);
});

test('deployments.list answers for the merge request head', async () => {
  const mr = await gl<{ sha: string }>('GET', '/merge_requests/1');
  const r = await rpc<DeploymentsData>('deployments/list', { target: MR_1 });
  assert.ok(r.ok, r.raw);
  assert.ok(Array.isArray(r.json.deployments));
  assert.equal(r.json.headSha, mr.sha);
});

for (const [label, query] of [
  ['merge request', `kind=gitlab-mr&host=${HOST}&project=${P}&number=1`],
  [
    'commit',
    `kind=gitlab-commit&host=${HOST}&project=${P}&sha=0b20f9eb972f78c9ad2f1b1c051d47971298984d`,
  ],
] as const) {
  test(`/api/diff answers 304 to the ETag it gave, for a ${label}`, async () => {
    const path = `/api/diff?${query}`;
    const first = await raw(path);
    assert.equal(first.status, 200, first.text.slice(0, 200));
    const etag = first.headers.get('etag');
    assert.ok(etag != null, 'no ETag on the patch');

    const again = await raw(path, { headers: { 'if-none-match': etag } });
    assert.equal(again.status, 304);
    assert.equal(again.text, '');

    // The tag names its project: another project never takes it.
    const elsewhere = await raw(
      path.replace(
        `project=${P}`,
        `project=${encodeURIComponent('e2e/elsewhere')}`
      ),
      { headers: { 'if-none-match': etag } }
    );
    assert.notEqual(elsewhere.status, 304);
  });
}

test('/api/file answers 304 to the ETag it gave', async () => {
  const path = `/api/file?kind=gitlab-mr&host=${HOST}&project=${P}&number=1&path=src/index.ts`;
  const first = await raw(path);
  assert.equal(first.status, 200, first.text.slice(0, 200));
  const etag = first.headers.get('etag');
  assert.ok(etag != null, 'no ETag on the file');

  const again = await raw(path, { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304);
  assert.equal(again.text, '');
});

test('a sign-in lasts 180 days, by the cookie’s own Max-Age', async () => {
  const res = await fetch(`${ORIGIN}/api/auth/gitlab/pat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ host: HOST, token: TOKEN }),
  });
  assert.equal(res.status, 204);
  const cookie = (res.headers.getSetCookie?.() ?? []).find((c) =>
    c.startsWith('__Host-ghdiff-session=')
  );
  const maxAge = Number(/Max-Age=(\d+)/i.exec(cookie ?? '')?.[1]);
  const days = maxAge / 86_400;
  assert.ok(days > 179 && days <= 180, `Max-Age is ${days} days`);
});

test('the hosted routes turn a local target away with 400', async () => {
  const query = 'kind=local-diff&root=%2Ftmp%2Frepo&mode=worktree';
  const d = await raw(`/api/diff?${query}`);
  assert.equal(d.status, 400, d.text);
  const f = await raw(`/api/file?${query}&path=a.txt`);
  assert.equal(f.status, 400, f.text);
});
