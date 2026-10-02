import { useMemo } from 'react';

import { useAppData } from '@/components/AppDataProvider';
import { pullScopePreference, usePreference } from '@/hooks/preferences';
import type { OpenPullsState } from '@/hooks/useOpenPulls';
import type { PullSummary } from '@/lib/pulls';
import {
  availablePullScopes,
  countPullScopes,
  effectivePullScope,
  expectedPullScopes,
  type PullScope,
  type PullScopeCounts,
  scopePulls,
} from '@/lib/pullScope';
import type { GitHubPullTarget } from '@/lib/reviewTarget';

export interface PullScopeState {
  counts: PullScopeCounts;
  /** The pull requests the scope draws, before they are grouped. */
  pulls: readonly PullSummary[];
  /** The scope that applies, which is not always the one stored. */
  scope: PullScope;
  setScope(next: PullScope): void;
  /** The tabs there are to choose from; one alone is no choice at all. */
  tabs: readonly PullScope[];
  viewer?: string;
  /**
   * Present while the first answer is on its way: the tabs and the chosen one
   * the answer is expected to bring, for the skeleton and the title to draw in
   * the meantime. See `expectedPullScopes`.
   */
  waiting?: { scope: PullScope; tabs: readonly PullScope[] };
}

/**
 * The list's scope, read the same way by everything that draws the list: the
 * wide bar, the narrow one, the phone's window, and the switch above them. A
 * jotai atom holds the choice, so a press in the switch reaches all of them
 * without anybody handing it down.
 */
export function usePullScope(
  state: OpenPullsState,
  current: GitHubPullTarget | undefined
): PullScopeState {
  const { value: stored, setValue: setScope } =
    usePreference(pullScopePreference);
  const { session } = useAppData();
  const { data, error } = state;
  const counts = useMemo(
    () => countPullScopes(data?.pulls ?? [], data?.viewer, current),
    [current, data]
  );
  const scope = effectivePullScope(stored, data?.viewer, counts);
  const pulls = useMemo(
    () =>
      data == null ? [] : scopePulls(data.pulls, data.viewer, scope, counts),
    [counts, data, scope]
  );
  const tabs = useMemo(
    () => availablePullScopes(data?.viewer, counts),
    [counts, data?.viewer]
  );
  // A session still being checked is guessed signed in: the reviewer who has
  // one is the reviewer who comes back, and a wrong guess is one skeleton that
  // goes away rather than one that arrives.
  const signedInGuess = session.signedIn || session.checking;
  const waiting = useMemo(
    () =>
      data == null && error == null
        ? expectedPullScopes(stored, signedInGuess, current)
        : undefined,
    [current, data, error, signedInGuess, stored]
  );
  return {
    counts,
    pulls,
    scope,
    setScope,
    tabs,
    viewer: data?.viewer,
    waiting,
  };
}
