import assert from 'node:assert/strict';
// Read-only endpoints: the RPCs that mutate nothing, asserted field by field.
// The drafts.list read-back is the one exception — it stages a draft first,
// and the after hook takes it back.
import { afterAll, test, vi } from 'vitest';

import {
  rpc,
  raw,
  ref,
  VIEWER,
  OWNER,
  REPO,
  MARK,
  isIsoDate,
  cleanupOwn,
  type ViewerGetAnswer,
} from './helpers';
import type { CommentPayload } from '@/lib/comments';
import type { AppInstallation } from '@/lib/installations';
import type { PullDetails } from '@/lib/pullDetails';
import type { OpenPullsAnswer } from '@/lib/pulls';
import type { SubmittedReview } from '@/lib/reviewDecision';
import type { ViewedFilesData } from '@/lib/viewedFiles';

afterAll(() => cleanupOwn([1]));

test('viewer.get anonymous answers nobody', async () => {
  const r = await rpc<ViewerGetAnswer>('viewer/get', {}, { auth: 'none' });
  assert.ok(r.ok, r.raw);
  assert.equal(r.json.viewer, undefined);
  assert.equal(r.json.fromSession, false);
  assert.equal(r.json.gitlab, undefined);
});

test('viewer.get with a Bearer token answers the viewer', async () => {
  const r = await rpc<ViewerGetAnswer>('viewer/get', {});
  assert.ok(r.ok, r.raw);
  assert.equal(r.json.viewer?.login, VIEWER.login);
  assert.equal(r.json.fromSession, false);
});

test('stats.served counts a served diff on the Node build', async () => {
  // The counter runs everywhere now: in-memory on Node, where a flush lands
  // up to a second behind the serve, so the figure is polled until it moves.
  const before = (await rpc<{ count: number }>('stats/served', {})).json.count;
  const d = await raw(
    `/api/diff?kind=github-pull&owner=${OWNER}&repo=${REPO}&number=3`
  );
  assert.ok(d.ok, `diff status ${d.status}`);
  await vi.waitFor(
    async () => {
      const after = (await rpc<{ count: number }>('stats/served', {})).json
        .count;
      assert.ok(after > before, `served ${after} did not move past ${before}`);
    },
    { timeout: 5000, interval: 500 }
  );
});

test('installations.list answers the fixture account and the placeholder App', async () => {
  // Anonymous: a fine-grained PAT gets a 403 from the installations
  // endpoint, which is not what the deployment answer is about. The e2e
  // deployment serves GitHub through a placeholder App, so an install URL
  // is offered; the fixture account has ghdiff installed nowhere.
  const r = await rpc<{
    installations: AppInstallation[];
    installUrl?: string;
  }>('installations/list', {}, { auth: 'none' });
  assert.ok(r.ok, r.raw);
  assert.deepEqual(r.json.installations, []);
  assert.match(
    r.json.installUrl ?? '',
    /^https:\/\/github\.com\/apps\/[^/]+\/installations\/new$/
  );
});

test('pulls.list returns the three fixture PRs with stack linkage', async () => {
  const r = await rpc<OpenPullsAnswer>('pulls/list', {
    repos: [{ forge: 'github', owner: OWNER, repo: REPO }],
  });
  assert.ok(r.ok, r.raw);
  assert.equal(r.json.failures?.length ?? 0, 0, r.raw);
  assert.equal(r.json.pulls.length, 3);
  assert.ok(Object.keys(r.json.viewers).length > 0, 'viewer not named');

  const byNumber = new Map(r.json.pulls.map((p) => [p.number, p]));
  const [pr1, pr2, pr3] = [byNumber.get(1), byNumber.get(2), byNumber.get(3)];
  assert.ok(pr1 && pr2 && pr3, 'missing a PR');

  assert.equal(pr1.title, 'Rework the fixture app');
  assert.equal(pr1.state, 'open');
  assert.equal(pr2.title, 'Extend the new feature (stacked)');
  assert.equal(pr2.baseRef, 'feature/rework', 'stack base');
  assert.equal(pr1.headRef, 'feature/rework', 'stack head');
  assert.equal(pr3.title, 'WIP settings panel');
  assert.equal(pr3.state, 'draft');

  for (const p of r.json.pulls) {
    assert.equal(p.author, VIEWER.login);
    assert.ok(isIsoDate(p.updatedAt), `updatedAt: ${p.updatedAt}`);
    // Authed list carries the review/check axes from GraphQL.
    assert.ok(p.status != null, `PR ${p.number} has no status`);
    assert.equal(typeof p.status.review, 'string');
    assert.equal(typeof p.status.check, 'string');
  }
});

test('pulls.get returns PR 1 details, GitHub-only figures included', async () => {
  const r = await rpc<PullDetails>('pulls/get', ref(1));
  assert.ok(r.ok, r.raw);
  const d = r.json;
  assert.equal(d.title, 'Rework the fixture app');
  assert.equal(d.state, 'open');
  assert.equal(d.author, VIEWER.login);
  assert.equal(d.headRef, 'feature/rework');
  assert.equal(d.baseRef, 'main');
  assert.ok(isIsoDate(d.createdAt));
  assert.match(d.body ?? '', /- \[ \]/);
  assert.equal(d.changedFiles, 12);
  assert.equal(d.commits, 1);
  assert.ok(
    d.additions != null &&
      d.additions > 0 &&
      d.deletions != null &&
      d.deletions > 0,
    'GitHub carries the figures'
  );
});

test('comments.list returns the seeded thread, field by field', async () => {
  const r = await rpc<CommentPayload[]>('comments/list', ref(1));
  assert.ok(r.ok, r.raw);
  const root = r.json.find((p) => p.threadId != null);
  assert.ok(root, 'no thread root');
  assert.equal(root.author, VIEWER.login);
  assert.ok(root.authorAvatarUrl?.startsWith('https://'));
  assert.equal(root.path, 'src/index.ts');
  assert.equal(root.line, 14);
  assert.equal(root.side, 'additions');
  assert.ok(isIsoDate(root.createdAt));
  assert.match(root.htmlUrl ?? '', /#discussion_r\d+/);

  const reply = r.json.find((p) => p.replyToId === root.remoteId);
  assert.ok(reply, 'seeded reply not linked to the root');

  for (const p of r.json) {
    assert.notEqual(p.author, 'unknown', `payload ${p.remoteId}`);
    assert.ok(p.author.length > 0);
  }
});

test('FIND: a PR-level comment is not in comments.list on GitHub', async ({
  annotate,
}) => {
  // The seeded issue comment stands on the pull request, but the GitHub
  // forge reads review threads only — GitLab lists the same note with
  // scope 'merge-request'. A difference to know about, not a failure.
  const r = await rpc<CommentPayload[]>('comments/list', ref(1));
  assert.ok(r.ok, r.raw);
  const present = r.json.some((p) => /first pass/.test(p.body));
  await annotate(
    present
      ? 'issue-level comments ARE listed on this GitHub build'
      : 'issue-level comments are NOT listed on GitHub (review threads only); on GitLab they are',
    'finding'
  );
});

test('drafts.list answers the staged drafts, each with its author', async () => {
  const created = await rpc<CommentPayload>('drafts/create', {
    ...ref(1),
    path: 'src/utils.ts',
    line: 17,
    side: 'additions',
    body: `${MARK} list read-back`,
  });
  assert.ok(created.ok, created.raw);
  const id = created.json.remoteId;
  const r = await rpc<{ drafts: CommentPayload[] }>('drafts/list', ref(1));
  assert.ok(r.ok, r.raw);
  const d = r.json.drafts.find((x) => x.remoteId === id);
  assert.ok(d, 'not listed');
  assert.equal(d.staged, true);
  assert.equal(d.author, VIEWER.login);
  assert.ok(d.authorAvatarUrl?.startsWith('https://'));
});

test('reviews.mine answers, and any recorded review is well-formed', async () => {
  // A reviewer may have left a verdict by hand, so absence is not asserted —
  // only that the call answers and what it reports is a real review.
  const r = await rpc<{ review?: SubmittedReview }>('reviews/mine', ref(1));
  assert.ok(r.ok, r.raw);
  if (r.json.review != null) {
    assert.equal(typeof r.json.review.id, 'number');
    assert.equal(typeof r.json.review.state, 'string');
  }
});

test('viewedFiles round-trips a mark through the forge', async () => {
  const set = await rpc('viewedFiles/set', {
    ...ref(1),
    path: 'src/index.ts',
    viewed: true,
  });
  assert.ok(set.ok, set.raw);
  const listed = await rpc<ViewedFilesData>('viewedFiles/list', ref(1));
  assert.ok(listed.ok, listed.raw);
  assert.ok(
    listed.json.paths.includes('src/index.ts'),
    `paths: ${listed.json.paths}`
  );
  const unset = await rpc('viewedFiles/set', {
    ...ref(1),
    path: 'src/index.ts',
    viewed: false,
  });
  assert.ok(unset.ok, unset.raw);
  const reread = await rpc<ViewedFilesData>('viewedFiles/list', ref(1));
  assert.ok(!reread.json.paths.includes('src/index.ts'));
});
