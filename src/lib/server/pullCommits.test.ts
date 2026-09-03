import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GitHubCommitSource } from '../pullCommits.ts';
import { CommentInputError, submitPullComment } from './pullComments.ts';
import { readPullCommits, requirePullCommit } from './pullCommits.ts';

const pull = { owner: 'owner', repo: 'repo', number: 7 };
const sha = (i: number) => i.toString(16).padStart(40, '0');
const source = (i: number): GitHubCommitSource => ({
  sha: sha(i),
  parents: [{ sha: sha(i - 1) }],
  commit: { message: `Commit ${i}`, author: { name: 'Author' } },
  author: null,
});
function fixture(total: number) {
  const calls: string[] = [];
  const fetchJson = async <T>(path: string): Promise<T> => {
    calls.push(path);
    const page = /page=(\d+)$/.exec(path);
    if (page == null) return { commits: total, head: { sha: sha(total) } } as T;
    const start = (Number(page[1]) - 1) * 100;
    return Array.from(
      { length: Math.max(0, Math.min(100, Math.min(total, 250) - start)) },
      (_, i) => source(start + i + 1)
    ) as T;
  };
  return { calls, fetchJson };
}

describe('PR commit pagination', () => {
  for (const total of [0, 1, 100, 101, 250, 251]) {
    it(`reports completeness for ${total} commits`, async () => {
      const { calls, fetchJson } = fixture(total);
      const result = await readPullCommits(fetchJson, pull);
      assert.equal(result.commits.length, Math.min(total, 250));
      assert.equal(result.truncated, total > 250);
      assert.equal(result.total, total);
      assert.ok(calls.length <= 4);
      assert.equal(
        result.commits.at(-1)?.sha,
        total === 0 ? undefined : sha(Math.min(total, 250))
      );
    });
  }
  it('distinguishes removed commits from a capped list', async () => {
    assert.throws(
      () =>
        requirePullCommit(
          { commits: [], total: 0, headSha: sha(1), truncated: false },
          sha(1)
        ),
      /no longer/
    );
    assert.throws(
      () =>
        requirePullCommit(
          { commits: [], total: 251, headSha: sha(251), truncated: true },
          sha(251)
        ),
      /250/
    );
  });
});

describe('comment write version binding', () => {
  it('posts a historical SHA even when the PR head has advanced', async () => {
    const { fetchJson } = fixture(3);
    const writes: { path: string; body: Record<string, unknown> }[] = [];
    await submitPullComment(
      {
        ...pull,
        commitSha: sha(1),
        body: 'Review',
        path: 'a.ts',
        line: 8,
        startLine: 7,
        side: 'deletions',
        startSide: 'deletions',
      },
      fetchJson,
      async (path, body) => {
        writes.push({ path, body });
        return undefined;
      }
    );
    assert.deepEqual(writes, [
      {
        path: '/repos/owner/repo/pulls/7/comments',
        body: {
          body: 'Review',
          commit_id: sha(1),
          path: 'a.ts',
          line: 8,
          start_line: 7,
          side: 'LEFT',
          start_side: 'LEFT',
        },
      },
    ]);
  });
  it('does not write after a force push removes the selected SHA', async () => {
    await assert.rejects(
      submitPullComment(
        { ...pull, commitSha: sha(10), body: 'Review', path: 'a.ts', line: 1 },
        fixture(3).fetchJson,
        async () => {
          assert.fail('must not write');
        }
      ),
      CommentInputError
    );
  });
  it('replies with only the root ID and body, without resolving a new commit', async () => {
    await submitPullComment(
      { ...pull, replyToId: 12, commitSha: sha(10), body: 'Reply' },
      async () => assert.fail('must not resolve a SHA'),
      async (path, body) => {
        assert.equal(path, '/repos/owner/repo/pulls/7/comments/12/replies');
        assert.deepEqual(body, { body: 'Reply' });
        return undefined;
      }
    );
  });
  it('keeps overall PR comments on head and propagates GitHub failures', async () => {
    await assert.rejects(
      submitPullComment(
        { ...pull, body: 'Review', path: 'a.ts', line: 1 },
        fixture(3).fetchJson,
        async (_path, body) => {
          assert.equal(body.commit_id, sha(3));
          throw new Error('GitHub refused that line');
        }
      ),
      /refused/
    );
  });
});
