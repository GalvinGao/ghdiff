import { useCallback, useLayoutEffect, useRef } from 'react';

// Marks a row with how many of its narrowing steps it needed to fit.
//
// Whether a row fits is a measurement, and a container query cannot take it: a
// query answers for the row's width and knows nothing of what is in it, so a
// threshold set for counts of one digit is wrong the day a repository has a
// hundred pull requests open. So this takes the steps in turn — it writes the
// steps taken so far into `data-fit`, which the stylesheet draws from, and
// reads the row back — and stops as soon as the row fits, or when there are no
// steps left. The steps add up: a row at the third step has taken the first
// two as well, and a rule for one step reads `data-fit~=step`, which holds for
// every row at that step or past it.
//
// Two readings say a layout does not fit. The children reaching further than
// the row's content box, which is what `shrink-0` controls do when the row is
// too narrow for them. And a child marked `data-fit-truncates` cutting its own
// text, which is what a `truncate` child does instead of overflowing: it would
// fit by showing one letter, and one letter is not fitting. The span is taken
// from the leftmost edge to the rightmost, so the reading is the same in a row
// laid out right to left.
//
// It writes onto the node and tells React nothing, the way `useEdgeFade` does:
// a pane drag resizes the row on every pointermove, and each attempt is an
// attribute and a layout read rather than a render.

function fits(row: HTMLElement): boolean {
  const style = getComputedStyle(row);
  const box = row.getBoundingClientRect();
  const width =
    box.width -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight) -
    parseFloat(style.borderLeftWidth) -
    parseFloat(style.borderRightWidth);
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (const child of row.children) {
    const rect = child.getBoundingClientRect();
    if (rect.width === 0) continue;
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.right);
  }
  // The tolerance is for the fractional widths a zoomed browser reports.
  if (right - left > width + 0.5) return false;
  for (const node of row.querySelectorAll<HTMLElement>(
    '[data-fit-truncates]'
  )) {
    if (node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 0.5) {
      return false;
    }
  }
  return true;
}

/**
 * Attach the returned callback as a `ref`. The row carries `data-fit`, the
 * space-separated `steps` it took to fit, and an empty value when it fit as it
 * was. `steps` is a constant of the caller's module, narrowest last. `key` is
 * whatever else changes what the row holds — a count arriving changes a width
 * without the row moving, and a control drawn late is not one the observer was
 * told about.
 */
export function useRowFit<T extends HTMLElement>(
  steps: readonly string[],
  key: string
): (node: T | null) => void {
  const nodeRef = useRef<T | null>(null);

  const measure = useCallback(() => {
    const row = nodeRef.current;
    if (row == null) return;
    for (let taken = 0; taken <= steps.length; taken += 1) {
      row.dataset.fit = steps.slice(0, taken).join(' ');
      if (fits(row)) return;
    }
  }, [steps]);

  // Before paint, so a count that gained a digit never shows the row it broke.
  useLayoutEffect(measure, [key, measure]);

  return useCallback(
    (node: T | null) => {
      nodeRef.current = node;
      if (node == null) return;
      measure();
      // The row's own width, and the width of each control in it: a count
      // gaining a digit and a narrower bar are the same question.
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      for (const child of node.children) observer.observe(child);
      return () => observer.disconnect();
    },
    [measure]
  );
}
