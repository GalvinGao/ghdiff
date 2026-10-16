import assert from 'node:assert/strict';
// The raw routes: /api/diff, /api/file, /api/media, the pages, and /healthz.
import { test } from 'vitest';

import { raw, OWNER, REPO } from './helpers';

const diff = (query: string) =>
  raw(`/api/diff?kind=${query}&owner=${OWNER}&repo=${REPO}`);
const countFiles = (text: string) =>
  text.split('\n').filter((l) => l.startsWith('diff --git')).length;

test('/healthz answers ok', async () => {
  const r = await raw('/healthz', { bearer: false });
  assert.equal(r.status, 200);
  assert.equal(r.text.trim(), 'ok');
});

test('/api/diff serves PR 1 with every change type', async () => {
  const r = await diff('github-pull&number=1');
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

test('/api/diff serves PR 2, PR 3, the commit and the compare', async () => {
  const cases: [string, number][] = [
    ['github-pull&number=2', 2],
    ['github-pull&number=3', 1],
    ['github-commit&sha=17be5f4b61eede12a565bbb0fbe0ff34dbca4426', 1],
    ['github-compare&base=main&head=feature/rework', 12],
  ];
  for (const [query, files] of cases) {
    const r = await diff(query);
    assert.equal(r.status, 200, `${query}: ${r.text.slice(0, 120)}`);
    assert.equal(countFiles(r.text), files, query);
  }
});

test('/api/diff answers 404 to an anonymous caller on a private repo', async () => {
  const r = await diff('github-pull&number=1');
  assert.equal(r.status, 200, 'control: authed read works');
  const anon = await diff('github-pull&number=1').then(() =>
    raw(`/api/diff?kind=github-pull&owner=${OWNER}&repo=${REPO}&number=1`, {
      bearer: false,
    })
  );
  assert.equal(anon.status, 404);
});

test('/api/file serves the new side of src/index.ts', async () => {
  const r = await raw(
    `/api/file?kind=github-pull&owner=${OWNER}&repo=${REPO}&number=1&path=src/index.ts`
  );
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.match(r.text, /version: 2/);
  assert.match(r.text, /newFeature\(config\.tags\)/);
});

test('/api/file serves the new side on a compare target too', async () => {
  // Hunk expansion calls /api/file with whatever target the page shows —
  // a compare included, not only a pull request.
  const r = await raw(
    `/api/file?kind=github-compare&owner=${OWNER}&repo=${REPO}&base=main&head=feature/rework&path=src/index.ts`
  );
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.match(r.text, /version: 2/);
});

test('/api/file rejects bad paths', async () => {
  const base = `/api/file?kind=github-pull&owner=${OWNER}&repo=${REPO}&number=1`;
  assert.equal((await raw(base)).status, 400, 'path missing');
  assert.equal((await raw(`${base}&path=..%2F..%2Fetc%2Fpasswd`)).status, 400);
  assert.equal((await raw(`${base}&path=src/..%2Findex.ts`)).status, 400);
});

test('/api/media proxies the repo image on a private repo', async () => {
  const upload = `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/assets/fixture.png`;
  const r = await raw(
    `/api/media?kind=github-pull&owner=${OWNER}&repo=${REPO}&number=1&url=${encodeURIComponent(upload)}`
  );
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.match(r.headers.get('content-type') ?? '', /^image\//);
});

test('page routes answer for the GitHub target', async () => {
  assert.equal((await raw('/', { bearer: false })).status, 200);
  assert.equal((await raw('/setup', { bearer: false })).status, 200);
  assert.equal(
    (await raw(`/github.com:${OWNER}/${REPO}/pull/1`, { bearer: false }))
      .status,
    200
  );
});
