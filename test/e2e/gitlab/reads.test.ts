import assert from 'node:assert/strict';
// Read-only endpoints: the RPCs that mutate nothing, asserted field by field.
import { test, vi } from 'vitest';

import {
  rpc,
  raw,
  ref,
  VIEWER,
  HOST,
  PROJECT,
  isIsoDate,
  type ViewerGetAnswer,
} from './helpers';
import type { CommentPayload } from '@/lib/comments';
import type { AppInstallation } from '@/lib/installations';
import type { PullDetails } from '@/lib/pullDetails';
import type { OpenPullsAnswer } from '@/lib/pulls';
import type { SubmittedReview } from '@/lib/reviewDecision';

test('viewer.get anonymous answers nobody', async () => {
  const r = await rpc<ViewerGetAnswer>('viewer/get', {}, { auth: 'none' });
  assert.ok(r.ok, r.raw);
  assert.equal(r.json.viewer, undefined);
  assert.equal(r.json.fromSession, false);
  assert.equal(r.json.gitlab, undefined);
});

test('viewer.get with a Bearer GitLab PAT (probe, documents the wart)', async ({
  annotate,
}) => {
  // The header credential wins on either forge for target-bound calls, but
  // viewer.get reads GitLab viewers from session grants only — and the same
  // header token is tried as a *GitHub* token, which it is not.
  const r = await rpc('viewer/get', {});
  await annotate(`status ${r.status}: ${r.raw.slice(0, 200)}`, 'probe');
  // The server answers — what it answers is the finding, reported in handoff.
  assert.notEqual(r.status, 0);
});

test('stats.served counts a served diff on the Node build', async () => {
  // The counter runs everywhere now: in-memory on Node, where a flush lands
  // up to a second behind the serve, so the figure is polled until it moves.
  const before = (await rpc<{ count: number }>('stats/served', {})).json.count;
  const d = await raw(
    `/api/diff?kind=gitlab-mr&host=${HOST}&project=${PROJECT}&number=3`
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
  // Anonymous: with a Bearer header the token is tried as a *GitHub* one —
  // the header-credentials wart the viewer.get probe documents. The e2e
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

test('pulls.list returns the three fixture MRs with stack linkage', async () => {
  const r = await rpc<OpenPullsAnswer>('pulls/list', {
    repos: [{ forge: 'gitlab', host: HOST, project: PROJECT }],
  });
  assert.ok(r.ok, r.raw);
  assert.equal(r.json.failures?.length ?? 0, 0, r.raw);
  assert.equal(r.json.pulls.length, 3);
  assert.ok(Object.keys(r.json.viewers).length > 0, 'viewer not named');

  const byNumber = new Map(r.json.pulls.map((p) => [p.number, p]));
  const [mr1, mr2, mr3] = [byNumber.get(1), byNumber.get(2), byNumber.get(3)];
  assert.ok(mr1 && mr2 && mr3, 'missing an MR');

  assert.equal(mr1.title, 'Rework the fixture app');
  assert.equal(mr1.state, 'open');
  assert.equal(mr2.title, 'Extend the new feature (stacked)');
  assert.equal(mr2.baseRef, 'feature/rework', 'stack base');
  assert.equal(mr1.headRef, 'feature/rework', 'stack head');
  assert.equal(mr3.title, 'Draft: WIP settings panel');
  assert.equal(mr3.state, 'draft');

  for (const p of r.json.pulls) {
    assert.equal(p.forge, 'gitlab');
    assert.equal(p.host, HOST);
    assert.equal(p.project, PROJECT);
    assert.equal(p.author, VIEWER.username);
    assert.ok(isIsoDate(p.updatedAt), `updatedAt: ${p.updatedAt}`);
    // Authed list carries the review/check axes.
    assert.ok(p.status != null, `MR ${p.number} has no status`);
    assert.equal(typeof p.status.review, 'string');
    assert.equal(typeof p.status.check, 'string');
  }
});

test('pulls.get returns MR 1 details', async () => {
  const r = await rpc<PullDetails>('pulls/get', ref(1));
  assert.ok(r.ok, r.raw);
  const d = r.json;
  assert.equal(d.title, 'Rework the fixture app');
  assert.equal(d.state, 'open');
  assert.equal(d.author, VIEWER.username);
  assert.equal(d.headRef, 'feature/rework');
  assert.equal(d.baseRef, 'main');
  assert.ok(isIsoDate(d.createdAt));
  assert.match(d.body ?? '', /- \[ \]/);
  assert.equal(d.changedFiles, 12);
  // GitHub-only figures: GitLab's merge request payload carries none of them.
  assert.equal(d.commits, undefined);
  assert.equal(d.additions, undefined);
  assert.equal(d.deletions, undefined);
});

test('comments.list returns the seeded thread, field by field', async () => {
  const r = await rpc<CommentPayload[]>('comments/list', ref(1));
  assert.ok(r.ok, r.raw);
  const root = r.json.find((p) => p.threadId != null);
  assert.ok(root, 'no thread root');
  assert.equal(root.author, VIEWER.username);
  assert.ok(root.authorAvatarUrl?.startsWith('https://'));
  assert.equal(root.authorIsBot, false);
  assert.equal(root.path, 'src/index.ts');
  assert.equal(root.line, 14);
  assert.equal(root.side, 'additions');
  // `resolved` travels only when true — an unresolved thread carries no mark.
  assert.equal(root.resolved, undefined);
  assert.ok(isIsoDate(root.createdAt));
  assert.match(root.htmlUrl ?? '', /#note_\d+$/);

  const reply = r.json.find((p) => p.replyToId === root.remoteId);
  assert.ok(reply, 'seeded reply not linked to the root');

  const mrNote = r.json.find((p) => p.scope === 'merge-request');
  assert.ok(mrNote, 'the seeded merge-request note is missing');
  assert.match(mrNote.body, /first pass/);

  for (const p of r.json) {
    assert.notEqual(p.author, 'unknown', `payload ${p.remoteId}`);
    assert.ok(p.author.length > 0);
  }
});

test('drafts.list returns staged drafts with the author resolved', async () => {
  const r = await rpc<{ drafts: CommentPayload[] }>('drafts/list', ref(1));
  assert.ok(r.ok, r.raw);
  // The user's own two drafts live here; the contract holds for every row.
  assert.ok(r.json.drafts.length >= 2, 'expected the seeded drafts');
  for (const d of r.json.drafts) {
    assert.equal(d.staged, true);
    assert.equal(d.author, VIEWER.username, `draft ${d.remoteId}`);
    assert.ok(d.authorAvatarUrl?.startsWith('https://'));
    assert.equal(typeof d.remoteId, 'number');
  }
});

test('reviews.mine answers no verdict on MR 1 and MR 2', async () => {
  for (const number of [1, 2]) {
    const r = await rpc<{ review?: SubmittedReview }>(
      'reviews/mine',
      ref(number)
    );
    assert.ok(r.ok, r.raw);
    assert.equal(r.json.review, undefined, `MR ${number}`);
  }
});

test('viewedFiles has no GitLab capability, on both procedures', async () => {
  const list = await rpc('viewedFiles/list', ref(1));
  assert.ok(!list.ok, `list answered ${list.status}`);
  const set = await rpc('viewedFiles/set', {
    ...ref(1),
    path: 'src/index.ts',
    viewed: true,
  });
  assert.ok(!set.ok, `set answered ${set.status}`);
});
