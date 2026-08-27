import { useCallback, useEffect, useRef } from 'react';

// Marks a scroll container with which of its edges still has content past it.
//
// Whether a row overflows is a measurement, and CSS cannot take it: a scroll
// timeline reports progress along a range and says nothing about whether the
// range exists, so at rest it cannot tell "there is more to the right" from
// "there is nothing to scroll at all". The second of those drawn as a fade is a
// claim about content that is not there.
//
// So this reads the two figures and writes two attributes, and the stylesheet
// draws from them. It writes them onto the node itself and tells React nothing:
// a scroll is a gesture reported many times a second, and a re-render per report
// is what `usePaneWidth` avoids for the same reason. Crossing an edge changes an
// attribute; everything between changes nothing.

/** True when the box is scrolled far enough that content is hidden left. */
function hasStart(node: HTMLElement): boolean {
  return node.scrollLeft > 1;
}

/** True when content runs past the right edge. The tolerance is for the
    fractional widths a zoomed-out browser reports. */
function hasEnd(node: HTMLElement): boolean {
  return node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
}

function mark(node: HTMLElement): void {
  node.toggleAttribute('data-fade-start', hasStart(node));
  node.toggleAttribute('data-fade-end', hasEnd(node));
}

/**
 * Attach the returned callback as a `ref`. While it is mounted the element
 * carries `data-fade-start` and `data-fade-end` for whichever edge hides
 * something.
 */
export function useEdgeFade<T extends HTMLElement>(): (node: T | null) => void {
  const nodeRef = useRef<T | null>(null);

  // One handler for both events and for the first measurement, so the element
  // cannot be marked by one path and left stale by another.
  const measure = useCallback(() => {
    const node = nodeRef.current;
    if (node != null) mark(node);
  }, []);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  return useCallback(
    (node: T | null) => {
      nodeRef.current = node;
      if (node == null) return;
      mark(node);
      node.addEventListener('scroll', measure, { passive: true });
      // The row's own width and the width of what is in it both move the
      // answer: a longer title and a narrower window are the same question.
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      for (const child of node.children) observer.observe(child);
      return () => {
        node.removeEventListener('scroll', measure);
        observer.disconnect();
      };
    },
    [measure]
  );
}
