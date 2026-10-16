import assert from 'node:assert/strict';
// Input validation and refusal states, endpoint by endpoint.
import { test } from 'vitest';

import { rpc, raw, ref, HOST, PROJECT, MARK } from './helpers';

const P = encodeURIComponent(PROJECT);

test('an unknown RPC procedure answers 404', async () => {
  const r = await rpc('nope/nope', {});
  assert.equal(r.status, 404);
  assert.match(r.raw, /No such procedure/);
});

test('comments.create refuses an empty body', async () => {
  const r = await rpc('comments/create', {
    ...ref(1),
    path: 'src/styles.css',
    line: 21,
    side: 'additions',
    body: '',
  });
  assert.ok(!r.ok, `answered ${r.status}`);
  assert.match(r.raw, /cannot be empty/);
});

test('drafts.remove refuses to name no id', async () => {
  const r = await rpc('drafts/remove', ref(1));
  assert.ok(!r.ok, `answered ${r.status}`);
  assert.match(r.raw, /needs an id/);
});

test('pulls.list refuses a malformed repository ref', async () => {
  const r = await rpc('pulls/list', {
    repos: [{ forge: 'gitlab', host: 'not a host!', project: PROJECT }],
  });
  assert.ok(!r.ok, `answered ${r.status}`);
});

test('an RPC naming an unconfigured host answers the gate', async () => {
  // The forge gate fires on every ref-taking procedure, not only /api/diff.
  const r = await rpc('pulls/get', {
    forge: 'gitlab',
    host: 'gitlab.example.com',
    project: 'foo/bar',
    number: 1,
  });
  assert.equal(r.status, 404);
  assert.match(r.raw, /serves GitHub on github\.com/);
});

test('/api/diff refuses an invalid target', async () => {
  const r = await raw(`/api/diff?kind=bogus&host=${HOST}&project=${P}`);
  assert.equal(r.status, 400);
  assert.match(r.text, /not valid/);
});

test('/api/diff refuses an unconfigured GitLab host', async () => {
  const r = await raw(
    '/api/diff?kind=gitlab-mr&host=gitlab.example.com&project=foo/bar&number=1'
  );
  assert.equal(r.status, 404);
  assert.match(r.text, /serves GitHub on github\.com/);
});

test('/api/media refuses a missing or overlong url', async () => {
  const base = `/api/media?kind=gitlab-mr&host=${HOST}&project=${P}&number=1`;
  assert.equal((await raw(base)).status, 400, 'url missing');
  const long = `/uploads/${'a'.repeat(2100)}`;
  assert.equal(
    (await raw(`${base}&url=${encodeURIComponent(long)}`)).status,
    400,
    'url overlong'
  );
});

test('comments.create refuses an anonymous caller', async () => {
  const r = await rpc(
    'comments/create',
    { ...ref(1), replyToId: 1599455, body: 'anonymous should not land' },
    { auth: 'none' }
  );
  assert.ok(!r.ok, `answered ${r.status}`);
});

test('a commit or compare ref takes no comment, draft, or verdict', async () => {
  // Commenting is a merge-request operation: the contract has no field for a
  // commit's sha or a compare's ends, so the refusal lands at input
  // validation, before any forge call. A commit diff's comments stay in the
  // reviewer's browser instead — they never travel here.
  const targets = [
    { sha: '0b20f9eb972f78c9ad2f1b1c051d47971298984d' },
    { base: 'main', head: 'feature/rework' },
  ];
  const calls = [
    (base: object) =>
      rpc<{ code?: string }>('comments/create', {
        ...base,
        path: 'src/index.ts',
        line: 1,
        side: 'additions',
        body: `${MARK} no commit comments`,
      }),
    (base: object) =>
      rpc<{ code?: string }>('drafts/create', {
        ...base,
        path: 'src/index.ts',
        line: 1,
        side: 'additions',
        body: `${MARK} no commit drafts`,
      }),
    (base: object) =>
      rpc<{ code?: string }>('reviews/submit', { ...base, event: 'COMMENT' }),
  ];
  for (const target of targets) {
    for (const call of calls) {
      const r = await call({
        forge: 'gitlab',
        host: HOST,
        project: PROJECT,
        ...target,
      });
      assert.equal(r.status, 400, r.raw.slice(0, 200));
      assert.equal(r.json.code, 'BAD_REQUEST');
    }
  }
});
