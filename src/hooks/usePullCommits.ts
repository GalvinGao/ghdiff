import { useCallback, useEffect, useRef, useState } from 'react';

import { readStoredJson, writeStoredString } from './useLocalStorage';
import { acceptReviewedCommits, type PullCommitsData } from '@/lib/pullCommits';
import type { GitHubPullTarget } from '@/lib/reviewTarget';
import { rpc, rpcErrorMessage } from '@/lib/rpc/client';

export function usePullCommits(pull?: GitHubPullTarget) {
  const owner = pull?.owner;
  const repo = pull?.repo;
  const number = pull?.number;
  const key = `ghdiff-reviewed-commits:${owner}/${repo}#${number}`;
  const [data, setData] = useState<PullCommitsData>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [reviewed, setReviewed] = useState<ReadonlySet<string>>(new Set());
  const controllerRef = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    if (owner == null || repo == null || number == null) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(undefined);
    try {
      const answer = await rpc.pulls.commits(
        { owner, repo, number },
        { signal: controller.signal }
      );
      if (!controller.signal.aborted) setData(answer);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(rpcErrorMessage(cause, 'Could not load commits.'));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [owner, repo, number]);
  useEffect(() => {
    setData(undefined);
    setReviewed(new Set(acceptReviewedCommits(readStoredJson(key, []))));
    void reload();
    return () => controllerRef.current?.abort();
  }, [key, reload]);
  const mark = useCallback(
    (sha: string, done: boolean) => {
      setReviewed((current) => {
        const next = new Set(current);
        if (done) next.add(sha);
        else next.delete(sha);
        writeStoredString(key, JSON.stringify([...next]));
        return next;
      });
    },
    [key]
  );
  return { data, error, loading, reviewed, mark, reload };
}
