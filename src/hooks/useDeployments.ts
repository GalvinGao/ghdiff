import { ORPCError } from '@orpc/client';
import { useRef } from 'react';

import { useSharedQuery } from './useSharedQuery';
import { type DeploymentsData, deploymentsInFlight } from '@/lib/deployments';
import type { GitHubReviewTarget } from '@/lib/reviewTarget';
import { rpc } from '@/lib/rpc/client';

/**
 * How often a build still in flight is asked about. A preview build takes
 * minutes, so a quarter of a minute is late by at most that much, and forty
 * requests over the ten minutes below are nothing against 5000 an hour.
 */
const POLL_MS = 15_000;
/**
 * How long one head is waited on. A build that has not answered in ten minutes
 * has usually stalled, and a push that deploys nothing — a change to the docs
 * alone — would otherwise keep checks-pending polling alive for as long as the
 * tab is open. A new head starts the clock again.
 */
const POLL_FOR_MS = 10 * 60_000;
/** The most a failing poll is spaced out, as a multiple of `POLL_MS`. */
const MAX_BACKOFF = 8;

/**
 * The deployments of the diff under review, kept fresh while a build is on its
 * way.
 *
 * React Query owns the schedule, which is the whole reason it is here: one
 * request in flight per target however many renders ask, no poll while the tab
 * is hidden and one fetch as it comes back, a retry with backoff behind a
 * failure, and an answer that stays on screen through the failure. Written by
 * hand that is four timers and a generation counter.
 *
 * Every tab on the same diff polls through one shared query, so the tab whose
 * turn comes second within a poll takes the answer the first one broadcast. The
 * share window is a little under the poll, which is what makes two tabs side
 * by side one request per poll rather than two. Nothing is written to disk: a
 * build's state from the last load is the one answer here certain to be wrong.
 *
 * A caller with no token is asked once and never polled. Each of its reads
 * costs up to five of sixty anonymous requests an hour, and the comments and
 * the pull request list need the rest.
 */
export function useDeployments(options: {
  target?: GitHubReviewTarget;
  signedIn: boolean;
  /** True until the session has answered, so a signed-in reviewer is not
      first asked about anonymously. */
  checking: boolean;
}) {
  const { target, signedIn, checking } = options;
  const source = target == null ? undefined : deploymentSource(target);
  // The head a poll is running for, and since when. Read and written inside
  // the scheduler only, never while rendering.
  const pollRef = useRef<{ head?: string; since: number } | null>(null);

  return useSharedQuery<DeploymentsData>({
    // Strings, not the target: the target object is rebuilt on every read of
    // the route, and a key that changed with it would refetch on every render.
    queryKey: [
      'deployments',
      target?.owner,
      target?.repo,
      source == null ? undefined : sourceKey(source),
      signedIn,
    ],
    fetch: (signal) => {
      if (target == null || source == null) {
        throw new Error('No target to ask about.');
      }
      return rpc.deployments.list(
        { owner: target.owner, repo: target.repo, source },
        { signal }
      );
    },
    enabled: target != null && !checking,
    shareWindowMs: POLL_MS - 1_000,
    staleTime: signedIn ? 0 : Infinity,
    refetchOnWindowFocus: signedIn,
    // A refusal is an answer, and asking again gets the same one.
    retry: (count, error) =>
      signedIn &&
      count < 2 &&
      !(error instanceof ORPCError && error.status < 500),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!signedIn || data == null || !deploymentsInFlight(data)) {
        pollRef.current = null;
        return false;
      }
      const now = Date.now();
      let poll = pollRef.current;
      if (poll == null || poll.head !== data.headSha) {
        poll = { head: data.headSha, since: now };
        pollRef.current = poll;
      }
      if (now - poll.since > POLL_FOR_MS) return false;
      const backoff = Math.min(2 ** query.state.fetchFailureCount, MAX_BACKOFF);
      return POLL_MS * backoff;
    },
  });
}

type DeploymentSource = Parameters<typeof rpc.deployments.list>[0]['source'];

function deploymentSource(target: GitHubReviewTarget): DeploymentSource {
  switch (target.kind) {
    case 'github-pull':
      return { kind: target.kind, number: target.number };
    case 'github-commit':
      return { kind: target.kind, sha: target.sha };
    case 'github-compare':
      return { kind: target.kind, base: target.base, head: target.head };
  }
}

function sourceKey(source: DeploymentSource): string {
  switch (source.kind) {
    case 'github-pull':
      return `pull:${source.number}`;
    case 'github-commit':
      return `commit:${source.sha}`;
    case 'github-compare':
      return `compare:${source.base}...${source.head}`;
  }
}
