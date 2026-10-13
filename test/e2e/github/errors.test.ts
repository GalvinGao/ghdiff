import assert from 'node:assert/strict';
// Input validation and refusal states, endpoint by endpoint.
import { test } from 'vitest';

import { rpc, raw, ref, OWNER, REPO, MARK } from './helpers';

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
    repos: [{ forge: 'github', owner: 'not an owner!', repo: REPO }],
  });
  assert.ok(!r.ok, `answered ${r.status}`);
});

test('/api/diff refuses an invalid target', async () => {
  const r = await raw(`/api/diff?kind=bogus&owner=${OWNER}&repo=${REPO}`);
  assert.equal(r.status, 400);
  assert.match(r.text, /not valid/);
});

test('/api/media refuses a missing or overlong url', async () => {
  const base = `/api/media?kind=github-pull&owner=${OWNER}&repo=${REPO}&number=1`;
  assert.equal((await raw(base)).status, 400, 'url missing');
  const long = `https://raw.githubusercontent.com/${'a'.repeat(2100)}`;
  assert.equal(
    (await raw(`${base}&url=${encodeURIComponent(long)}`)).status,
    400,
    'url overlong'
  );
});

test('comments.create refuses an anonymous caller', async () => {
  const r = await rpc(
    'comments/create',
    { ...ref(1), replyToId: 1, body: 'anonymous should not land' },
    { auth: 'none' }
  );
  assert.ok(!r.ok, `answered ${r.status}`);
});

test('a commit or compare ref takes no comment, draft, or verdict', async () => {
  // Commenting is a pull-request operation: the contract has no field for a
  // commit's sha or a compare's ends, so the refusal lands at input
  // validation, before any forge call. A commit diff's comments stay in the
  // reviewer's browser instead — they never travel here.
  const targets = [
    { sha: '17be5f4b61eede12a565bbb0fbe0ff34dbca4426' },
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
        forge: 'github',
        owner: OWNER,
        repo: REPO,
        ...target,
      });
      assert.equal(r.status, 400, r.raw.slice(0, 200));
      assert.equal(r.json.code, 'BAD_REQUEST');
    }
  }
});
