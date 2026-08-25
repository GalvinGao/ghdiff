// A GitHub pull request stack, read out of the branches themselves.
//
// GitHub has no stack object to ask for. What it has is a base branch per pull
// request, and a stack is what that leaves behind: when one open pull request
// targets the head branch of another open pull request, the first is stacked on
// the second. `gh-stack` and every other stacking tool build their chains the
// same way, so reviewer needs no extra field from the API to draw them.

import type { PullSummary } from './pulls.ts';

export interface PullStackNode {
  pull: PullSummary;
  /** The open pull requests whose base branch is this one's head branch. */
  children: PullStackNode[];
}

/**
 * The stacks in one set of pull requests, as a forest. A pull request that
 * nothing is stacked on and that stands on nothing is its own single-node stack,
 * so the caller draws one list and not two.
 *
 * Roots come newest number first, and so do the children of every node: the
 * requested order for anything at the same level of a stack.
 */
export function buildPullStacks(
  pulls: readonly PullSummary[]
): PullStackNode[] {
  // The pull request that owns each head branch. Two open pull requests cannot
  // share a head branch on GitHub, but a set assembled from several repositories
  // can, so the first one wins rather than the last.
  const byHead = new Map<string, PullSummary>();
  for (const pull of pulls) {
    if (!byHead.has(pull.headRef)) byHead.set(pull.headRef, pull);
  }

  const parentOf = new Map<number, number>();
  for (const pull of pulls) {
    const parent = byHead.get(pull.baseRef);
    if (parent != null && parent.number !== pull.number) {
      parentOf.set(pull.number, parent.number);
    }
  }
  breakCycles(pulls, parentOf);

  const nodes = new Map<number, PullStackNode>();
  for (const pull of pulls) {
    nodes.set(pull.number, { pull, children: [] });
  }

  const roots: PullStackNode[] = [];
  for (const pull of pulls) {
    const node = nodes.get(pull.number);
    if (node == null) continue;
    const parentNumber = parentOf.get(pull.number);
    const parent = parentNumber == null ? undefined : nodes.get(parentNumber);
    if (parent == null) roots.push(node);
    else parent.children.push(node);
  }

  sortByNumberDesc(roots);
  return roots;
}

/**
 * Two branches can target each other, and a rebase can leave a longer ring. A
 * ring has no root, so its nodes would never be drawn at all. Cutting one link
 * of each ring turns it back into a chain.
 */
function breakCycles(
  pulls: readonly PullSummary[],
  parentOf: Map<number, number>
): void {
  for (const pull of pulls) {
    const seen = new Set<number>([pull.number]);
    let current = parentOf.get(pull.number);
    while (current != null) {
      if (seen.has(current)) {
        parentOf.delete(pull.number);
        break;
      }
      seen.add(current);
      current = parentOf.get(current);
    }
  }
}

function sortByNumberDesc(nodes: PullStackNode[]): void {
  nodes.sort((a, b) => b.pull.number - a.pull.number);
  for (const node of nodes) sortByNumberDesc(node.children);
}

/** How many pull requests a forest holds, at every depth. */
export function countStackNodes(nodes: readonly PullStackNode[]): number {
  let total = 0;
  for (const node of nodes) total += 1 + countStackNodes(node.children);
  return total;
}
