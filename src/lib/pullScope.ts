// Which open pull requests the list draws: all of them, the viewer's own, every
// one but the viewer's own, or the stack the pull request on screen belongs to.
//
// One value rather than a switch per axis, because the axes do not combine. A
// stack is built inside one author's pull requests, so "this stack, but only
// mine" is either the whole stack or nothing, and a reviewer cannot ask for
// both halves of a partition at once without asking for everything — which is
// what `all` already means. So the switch is a set of tabs with one always
// chosen, and `all` is a tab of its own rather than the absence of a press.
//
// A scope the moment cannot honour falls back to everything rather than to an
// empty list. `stack` is stored like the other three, and the home page has no
// pull request on screen to have a stack; signed out, nothing on the list is
// "mine". `effectivePullScope` is what turns the stored choice into the one
// that applies, and both the list and the switch read that answer, so the
// switch cannot show a scope pressed that the list is not drawing.

import { flattenStacks, isViewerPull, type PullSummary } from './pulls.ts';
import { buildPullStacks } from './pullStacks.ts';
import type { GitHubPullTarget } from './reviewTarget.ts';

export type PullScope = 'all' | 'mine' | 'others' | 'stack';

export const PULL_SCOPES: readonly PullScope[] = [
  'all',
  'mine',
  'others',
  'stack',
];

export function isPullScope(value: unknown): value is PullScope {
  return PULL_SCOPES.includes(value as PullScope);
}

/** What each scope would draw, counted before any of them is applied. */
export interface PullScopeCounts {
  mine: number;
  others: number;
  /**
   * The pull requests in the stack on screen, or absent when the pull request
   * on screen stands alone, is not in the list, or there is none.
   */
  stack?: readonly PullSummary[];
}

/**
 * The stack the pull request on screen belongs to, root to tip, when it has more
 * than one pull request in it. A pull request on its own is not a stack, and a
 * scope of one row would be a filter that hides everything but the row the
 * reviewer is already reading.
 */
export function currentStackPulls(
  pulls: readonly PullSummary[],
  current: GitHubPullTarget | undefined
): PullSummary[] | undefined {
  if (current == null) return undefined;
  const self = pulls.find((pull) => sameTarget(pull, current));
  if (self == null) return undefined;
  // The same set `groupPullsByRepo` builds stacks from — one repository, one
  // author — so the stack named here is the block the list draws.
  const author = self.author.toLowerCase();
  const siblings = pulls.filter(
    (pull) => sameRepo(pull, current) && pull.author.toLowerCase() === author
  );
  for (const root of buildPullStacks(siblings)) {
    const chain = flattenStacks([root]).map((node) => node.pull);
    if (chain.some((pull) => pull.number === self.number)) {
      return chain.length > 1 ? chain : undefined;
    }
  }
  return undefined;
}

export function countPullScopes(
  pulls: readonly PullSummary[],
  viewer: string | undefined,
  current: GitHubPullTarget | undefined
): PullScopeCounts {
  const viewerLogin = viewer?.toLowerCase();
  let mine = 0;
  for (const pull of pulls) if (isViewerPull(pull, viewerLogin)) mine += 1;
  return {
    mine,
    others: pulls.length - mine,
    stack: currentStackPulls(pulls, current),
  };
}

/**
 * The tabs the switch draws, in its order. `all` is always one of them, and a
 * switch with nothing beside it offers no choice, so the caller draws none.
 */
export function availablePullScopes(
  viewer: string | undefined,
  counts: PullScopeCounts
): PullScope[] {
  const scopes: PullScope[] = ['all'];
  if (viewer != null) scopes.push('mine', 'others');
  if (counts.stack != null) scopes.push('stack');
  return scopes;
}

/**
 * The tabs and the chosen one to draw while the list has not arrived yet, so
 * the wait has the answer's shape: a skeleton of the tabs that will be there,
 * under a title that names the tab that will be chosen. Nobody signed in is a
 * switch with nothing to offer, unless the stack is: whether the pull request
 * on screen has one is part of the answer still on its way, so the stored
 * choice is the guess — a reviewer who left the list on This Stack is very
 * likely reading a stack again. A wrong guess costs one change of shape when
 * the answer lands, which is what every wait cost before.
 */
export function expectedPullScopes(
  stored: PullScope,
  signedIn: boolean,
  current: GitHubPullTarget | undefined
): { scope: PullScope; tabs: PullScope[] } {
  const stack = stored === 'stack' && current != null;
  const tabs: PullScope[] = ['all'];
  if (signedIn) tabs.push('mine', 'others');
  if (stack) tabs.push('stack');
  return { scope: tabs.includes(stored) ? stored : 'all', tabs };
}

/** The scope that applies: the stored one, or `all` where it cannot. */
export function effectivePullScope(
  scope: PullScope,
  viewer: string | undefined,
  counts: PullScopeCounts
): PullScope {
  if (scope === 'stack') return counts.stack == null ? 'all' : 'stack';
  if (scope === 'mine' || scope === 'others') {
    return viewer == null ? 'all' : scope;
  }
  return 'all';
}

/** The pull requests a scope draws. Pass the effective scope. */
export function scopePulls(
  pulls: readonly PullSummary[],
  viewer: string | undefined,
  scope: PullScope,
  counts: PullScopeCounts
): readonly PullSummary[] {
  const viewerLogin = viewer?.toLowerCase();
  switch (scope) {
    case 'all':
      return pulls;
    case 'mine':
      return pulls.filter((pull) => isViewerPull(pull, viewerLogin));
    case 'others':
      return pulls.filter((pull) => !isViewerPull(pull, viewerLogin));
    case 'stack':
      return counts.stack ?? pulls;
  }
}

function sameRepo(pull: PullSummary, target: GitHubPullTarget): boolean {
  return (
    pull.owner.toLowerCase() === target.owner.toLowerCase() &&
    pull.repo.toLowerCase() === target.repo.toLowerCase()
  );
}

function sameTarget(pull: PullSummary, target: GitHubPullTarget): boolean {
  return sameRepo(pull, target) && pull.number === target.number;
}
