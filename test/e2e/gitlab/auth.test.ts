import assert from 'node:assert/strict';
// The session flow a browser takes: PAT sign-in seals the cookie, the cookie
// speaks for every call, signout drops it. Uses the real PAT — signout
// revokes OAuth grants only, never a PAT.
import { test } from 'vitest';

import {
  ORIGIN,
  rpc,
  raw,
  ref,
  HOST,
  PROJECT,
  VIEWER,
  TOKEN,
  type ViewerGetAnswer,
} from './helpers';
import type { CommentPayload } from '@/lib/comments';

const ORIGIN_HEADER = { origin: ORIGIN };

async function signIn(token = TOKEN, host = HOST) {
  const res = await fetch(`${ORIGIN}/api/auth/gitlab/pat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...ORIGIN_HEADER },
    body: JSON.stringify({ host, token }),
  });
  const cookies = res.headers.getSetCookie?.() ?? [];
  const session = cookies
    .map((c) => c.split(';')[0])
    .filter((c) => c.startsWith('__Host-ghdiff-session='))
    .join('; ');
  return { res, session, cookies };
}

test('PAT sign-in seals the session cookie', async () => {
  const { res, session, cookies } = await signIn();
  assert.equal(res.status, 204, `status ${res.status}`);
  assert.ok(session.length > 0, `no session cookie in ${cookies.join(', ')}`);
});

test('the cookie answers viewer.get, comments.list and /api/diff', async () => {
  const { session } = await signIn();
  assert.ok(session.length > 0);

  const viewer = await rpc<ViewerGetAnswer>(
    'viewer/get',
    {},
    { auth: 'none', cookie: session }
  );
  assert.ok(viewer.ok, viewer.raw);
  assert.equal(viewer.json.fromSession, true);
  const conn = viewer.json.gitlab?.find((g) => g.host === HOST);
  assert.ok(conn, 'no GitLab connection for the host');
  assert.equal(conn.viewer.login, VIEWER.username);

  const comments = await rpc<CommentPayload[]>('comments/list', ref(1), {
    auth: 'none',
    cookie: session,
  });
  assert.ok(comments.ok, comments.raw);
  assert.ok(
    comments.json.some((p) => p.threadId != null),
    'seeded thread missing'
  );

  const diff = await raw(
    `/api/diff?kind=gitlab-mr&host=${HOST}&project=${encodeURIComponent(PROJECT)}&number=1`,
    { bearer: false, cookie: session }
  );
  assert.equal(diff.status, 200, 'session cookie did not authorize the diff');
});

test('signout expires the cookie', async () => {
  const { session } = await signIn();
  const res = await fetch(`${ORIGIN}/api/auth/signout`, {
    method: 'POST',
    headers: { cookie: session, ...ORIGIN_HEADER },
  });
  assert.equal(res.status, 204);
  const cleared = (res.headers.getSetCookie?.() ?? []).find((c) =>
    c.startsWith('__Host-ghdiff-session=')
  );
  assert.ok(cleared, 'signout did not rewrite the session cookie');
  assert.match(cleared, /expires=Thu, 01 Jan 1970|max-age=0/i);

  // And the deployment answers anonymously to a request carrying nothing.
  const viewer = await rpc<ViewerGetAnswer>('viewer/get', {}, { auth: 'none' });
  assert.equal(viewer.json.gitlab, undefined);
});

test('a bad token is refused with 401', async () => {
  const { res } = await signIn('glpat-definitely-not-valid');
  assert.equal(res.status, 401);
});

test('a host the deployment does not serve is refused with 400', async () => {
  const { res } = await signIn(TOKEN, 'gitlab.example.com');
  assert.equal(res.status, 400);
});

test('a cross-origin sign-in is refused with 403', async () => {
  const res = await fetch(`${ORIGIN}/api/auth/gitlab/pat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://evil.example',
    },
    body: JSON.stringify({ host: HOST, token: TOKEN }),
  });
  assert.equal(res.status, 403);
});
