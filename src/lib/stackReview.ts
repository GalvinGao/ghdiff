// Where the pull request on screen sits in its stack, for the review dialog.
//
// A stack is reviewed in order: each layer is the diff the next one is written
// against. So inside a stack, Approve is the end of one layer and the start of
// the next, and the dialog turns it into one press that does both. The order is
// the one the left bar draws the stack in, which is `flattenStacks`' order — a
// reviewer who looks up from the dialog sees the next row directly under the
// one they are on.

import { type PullSummary, reviewTargetFromPull } from './pulls';
import { currentStackPulls, type PullTarget } from './pullScope';

/**
 * The address of a pull request or merge request the list holds, on its own
 * forge: a GitLab stack goes on to the next merge request the way a GitHub one
 * goes on to the next pull request.
 */
export function stackPullTarget(pull: PullSummary): PullTarget {
  return reviewTargetFromPull(pull);
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
  current: PullTarget | undefined
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
