// Where the pull request on screen sits in its stack, for the review dialog.
//
// A stack is reviewed in order: each layer is the diff the next one is written
// against. So inside a stack, Approve is the end of one layer and the start of
// the next, and the dialog turns it into one press that does both. The order is
// the one the left bar draws the stack in, which is `flattenStacks`' order — a
// reviewer who looks up from the dialog sees the next row directly under the
// one they are on.

import type { PullSummary } from './pulls.ts';
import { currentStackPulls } from './pullScope.ts';
import type { GitHubPullTarget } from './reviewTarget.ts';

/** The address of a pull request the list holds. */
export function stackPullTarget(pull: PullSummary): GitHubPullTarget {
  return {
    kind: 'github-pull',
    owner: pull.owner,
    repo: pull.repo,
    number: pull.number,
  };
}

export interface StackPosition {
  /** One-based, in the order the bar draws the stack. */
  position: number;
  total: number;
  /** The layer Approve goes on to. Absent on the last one. */
  next?: PullSummary;
}

/**
 * The place of the pull request on screen in its stack, or nothing when it
 * stands alone, is not in the list, or the list has not arrived. The stacks
 * come from the watch list, so a repository nobody watches has none here — the
 * same rule that decides whether the bar draws the stack at all.
 */
export function stackPosition(
  pulls: readonly PullSummary[],
  current: GitHubPullTarget | undefined
): StackPosition | undefined {
  const chain = currentStackPulls(pulls, current);
  if (chain == null || current == null) return undefined;
  const index = chain.findIndex((pull) => pull.number === current.number);
  if (index < 0) return undefined;
  return {
    position: index + 1,
    total: chain.length,
    next: chain[index + 1],
  };
}
