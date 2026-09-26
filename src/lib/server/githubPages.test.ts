import assert from 'node:assert/strict';
import { it } from 'node:test';

import { fetchGitHubPages } from './githubPages.ts';

it('appends pages to a query, keeps order, and stops at a short page', async () => {
  const calls: string[] = [];
  const { rows, truncated } = await fetchGitHubPages<number>(
    async <T>(path: string) => {
      calls.push(path);
      return (
        path.endsWith('page=1')
          ? Array.from({ length: 100 }, (_, i) => i)
          : [100]
      ) as T;
    },
    { path: '/files?ref=main', maxPages: 3, select: (page) => page }
  );
  assert.deepEqual(calls, [
    '/files?ref=main&per_page=100&page=1',
    '/files?ref=main&per_page=100&page=2',
  ]);
  assert.deepEqual(
    rows,
    Array.from({ length: 101 }, (_, i) => i)
  );
  assert.equal(truncated, false);
});

it('marks a full final page as potentially truncated', async () => {
  const { rows, truncated } = await fetchGitHubPages<number>(
    async <T>() => Array.from({ length: 100 }, (_, i) => i) as T,
    { path: '/files', maxPages: 1, select: (page) => page }
  );
  assert.equal(rows.length, 100);
  assert.equal(truncated, true);
});
