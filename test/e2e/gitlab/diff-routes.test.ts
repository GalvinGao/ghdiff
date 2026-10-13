import assert from 'node:assert/strict';
// The raw routes: /api/diff, /api/file, /api/media, /api/resolve, the pages,
// and /healthz.
import { test } from 'vitest';

import {
  raw,
  gl,
  HOST,
  PROJECT,
  ORIGIN,
  TOKEN,
  type GlMergeRequest,
} from './helpers';

const P = encodeURIComponent(PROJECT);
const diff = (query: string) =>
  raw(`/api/diff?kind=${query}&host=${HOST}&project=${P}`);
const countFiles = (text: string) =>
  text.split('\n').filter((l) => l.startsWith('diff --git')).length;

test('/healthz answers ok', async () => {
  const r = await raw('/healthz', { bearer: false });
  assert.equal(r.status, 200);
  assert.equal(r.text.trim(), 'ok');
});

test('/api/diff serves MR 1 with every change type', async () => {
  const r = await diff('gitlab-mr&number=1');
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.match(r.headers.get('content-type') ?? '', /text\/plain/);
  assert.equal(countFiles(r.text), 12);
  assert.match(r.text, /rename from docs\/guide\.md/);
  assert.match(r.text, /rename to docs\/manual\.md/);
  assert.match(r.text, /rename from src\/rename-me\.ts/);
  assert.match(r.text, /new file mode/);
  assert.match(r.text, /deleted file mode/);
  // The whitespace-only reindent arrives as a -/+ pair.
  assert.match(r.text, /^- {2}return input$/m);
  assert.match(r.text, /^\+ {4}return input$/m);
});

test('/api/diff serves MR 2, MR 3, the commit and the compare', async () => {
  const cases: [string, number][] = [
    ['gitlab-mr&number=2', 2],
    ['gitlab-mr&number=3', 1],
    ['gitlab-commit&sha=0b20f9eb972f78c9ad2f1b1c051d47971298984d', 1],
    ['gitlab-compare&base=main&head=feature/rework', 12],
  ];
  for (const [query, files] of cases) {
    const r = await diff(query);
    assert.equal(r.status, 200, `${query}: ${r.text.slice(0, 120)}`);
    assert.equal(countFiles(r.text), files, query);
  }
});

test('/api/diff refuses an unconfigured host with the gate sentence', async () => {
  const r = await raw(
    '/api/diff?kind=gitlab-mr&host=gitlab.example.com&project=foo/bar&number=1'
  );
  assert.equal(r.status, 404);
  assert.match(r.text, /serves GitHub on github\.com/);
});

test('/api/diff answers 404 to an anonymous caller on a private project', async () => {
  const r = await diff('gitlab-mr&number=1');
  assert.equal(r.status, 200, 'control: authed read works');
  const anon = await raw(
    `/api/diff?kind=gitlab-mr&host=${HOST}&project=${P}&number=1`,
    { bearer: false }
  );
  assert.equal(anon.status, 404);
});

test('/api/file serves the new side of src/index.ts', async () => {
  const r = await raw(
    `/api/file?kind=gitlab-mr&host=${HOST}&project=${P}&number=1&path=src/index.ts`
  );
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.match(r.text, /version: 2/);
  assert.match(r.text, /newFeature\(config\.tags\)/);
});

test('/api/file serves the new side on a compare target too', async () => {
  // Hunk expansion calls /api/file with whatever target the page shows —
  // a compare included, not only a merge request.
  const r = await raw(
    `/api/file?kind=gitlab-compare&host=${HOST}&project=${P}&base=main&head=feature/rework&path=src/index.ts`
  );
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.match(r.text, /version: 2/);
});

test('/api/file rejects bad paths', async () => {
  const base = `/api/file?kind=gitlab-mr&host=${HOST}&project=${P}&number=1`;
  assert.equal((await raw(base)).status, 400, 'path missing');
  assert.equal((await raw(`${base}&path=..%2F..%2Fetc%2Fpasswd`)).status, 400);
  assert.equal((await raw(`${base}&path=src/..%2Findex.ts`)).status, 400);
});

test('/api/media proxies the uploaded image', async () => {
  const mr = await gl<GlMergeRequest>('GET', '/merge_requests/1');
  const upload = mr.description?.match(/\/uploads\/[^)"]+/)?.[0];
  assert.ok(upload, 'no upload in the MR description');
  const r = await raw(
    `/api/media?kind=gitlab-mr&host=${HOST}&project=${P}&number=1&url=${encodeURIComponent(upload)}`
  );
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.match(r.headers.get('content-type') ?? '', /^image\//);
});

test('/api/resolve answers a bare GitLab path with its canonical path', async () => {
  // The probe reads the session's own grant, so sign in first — a Bearer
  // header is not a session, and a private project is invisible without one.
  const signin = await fetch(`${ORIGIN}/api/auth/gitlab/pat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ host: HOST, token: TOKEN }),
  });
  const session = (signin.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .filter((c) => c.startsWith('__Host-ghdiff-session='))
    .join('; ');
  assert.ok(session.length > 0, 'sign-in failed');
  // The canonical path is the 200's body: a redirect's answer reaches a
  // browser fetch filtered to an opaque-redirect response, headerless.
  const r = await raw(`/api/resolve?path=${P}/-/merge_requests/1`, {
    bearer: false,
    cookie: session,
  });
  assert.equal(r.status, 200);
  assert.equal(r.text.trim(), `/${HOST}:${PROJECT}/-/merge_requests/1`);
});

test('/api/resolve answers 404 anonymous on a private project, 400 on a bad path', async () => {
  const anon = await raw(`/api/resolve?path=${P}/-/merge_requests/1`, {
    bearer: false,
  });
  assert.equal(anon.status, 404);
  const bad = await raw('/api/resolve?path=nonsense');
  assert.equal(bad.status, 400);
});

test('page routes answer, and hostless forms resolve inside the app', async () => {
  assert.equal((await raw('/', { bearer: false })).status, 200);
  assert.equal((await raw('/setup', { bearer: false })).status, 200);
  assert.equal(
    (await raw(`/${HOST}:${P}/-/merge_requests/1`, { bearer: false })).status,
    200
  );

  // A bare GitLab path is not a document redirect to /api/resolve: the splat
  // answers the app itself, and the browser resolves the host from the marker
  // the page renders — the resolve call itself is covered above.
  const hostless = await raw(`/${P}/-/merge_requests/1`, { bearer: false });
  assert.equal(hostless.status, 200);
  assert.match(hostless.text, /Finding the GitLab host/);

  const legacy = await raw(`/${HOST}/${P}/-/merge_requests/1`, {
    bearer: false,
  });
  assert.equal(legacy.status, 301);
  assert.equal(
    legacy.headers.get('location'),
    `/${HOST}:${PROJECT}/-/merge_requests/1`
  );

  const ghShaped = await raw('/owner/repo/pull/1', { bearer: false });
  assert.equal(ghShaped.status, 302);
  assert.equal(
    ghShaped.headers.get('location'),
    '/github.com:owner/repo/pull/1'
  );
});
