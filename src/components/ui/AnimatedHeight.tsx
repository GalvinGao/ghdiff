import { type ReactNode, useCallback, useRef } from 'react';

import { cn } from '@/lib/cn';

// A box that travels between two content heights instead of jumping between
// them.
//
// `height: auto` is not an interpolable value, so no stylesheet can carry a box
// from the height of one answer to the height of the next: CSS holds the timing
// and never the two figures. So this measures the content and writes the
// figure, which is the division of labour `useEdgeFade` and `usePaneWidth`
// already make — the measurement is JavaScript's, and nothing is told to React.
//
// The first write needs no special case. It replaces `auto`, which a transition
// cannot start from, so the browser lands on it in one frame and a box arrives
// at the height of its first content with no animation to sit through.
//
// While a height is in flight the box clips, because a box shorter than its
// content is the whole of what a reveal is. It clips then and not at rest: a
// `focus-visible` ring in this app is drawn outside the control's own box, and a
// permanent clip would cut the ring off the last row of a panel.

/** The length of the travel, stated once: the box's own `transitionDuration`
    reads it, and so does the timer that lifts the clip if no transition ran. */
const DURATION_MS = 200;

/** No overshoot. A curve that crests past 1 would open a strip of empty box
    below the content it is revealing, and clip into it on the way back. */
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';

function prefersReducedMotion(): boolean {
  return (
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

export function AnimatedHeight({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const heightRef = useRef<number | null>(null);
  const clipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const unclip = useCallback(() => {
    if (clipTimerRef.current != null) {
      clearTimeout(clipTimerRef.current);
      clipTimerRef.current = null;
    }
    boxRef.current?.removeAttribute('data-animating');
  }, []);

  const content = useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) return;
      // `observe` reports the size it already has, so the box takes its first
      // height before the browser has painted anything.
      const observer = new ResizeObserver((entries) => {
        const box = boxRef.current;
        if (box == null) return;
        // A box that is not being displayed has no height to travel from or to.
        // `display: none` is reported here as a size of zero — a closed
        // `<dialog>` keeps its children mounted, and a pane hidden on a phone is
        // hidden and not unmounted — and taking that for content would leave the
        // box animating up from nothing every time it came back.
        if (node.getClientRects().length === 0) return;
        const height =
          entries[0]?.borderBoxSize[0]?.blockSize ??
          node.getBoundingClientRect().height;
        const previous = heightRef.current;
        // A fraction of a pixel is a rounding difference and not a new answer.
        if (previous != null && Math.abs(previous - height) < 0.5) return;
        heightRef.current = height;
        if (previous != null && !prefersReducedMotion()) {
          // Set with the height and never after it: a box already at its new
          // height has nothing left to clip, and the frame in between is the
          // one where the content overhangs.
          box.setAttribute('data-animating', '');
          // The backstop. `transitionend` is the ordinary way out of the clip,
          // and a transition that never runs — a hidden pane, a tab in the
          // background — never reports one.
          if (clipTimerRef.current != null) clearTimeout(clipTimerRef.current);
          clipTimerRef.current = setTimeout(unclip, DURATION_MS + 50);
        }
        box.style.height = `${String(height)}px`;
      });
      observer.observe(node);
      return () => observer.disconnect();
    },
    [unclip]
  );

  return (
    <div
      ref={boxRef}
      className={cn(
        'transition-[height] motion-reduce:transition-none',
        '[&[data-animating]]:overflow-hidden',
        className
      )}
      style={{
        transitionDuration: `${String(DURATION_MS)}ms`,
        transitionTimingFunction: EASING,
      }}
      // A child's own transition reports here as well — every button in this app
      // transitions its background — so the box asks for its own property.
      onTransitionEnd={(event) => {
        if (event.target === boxRef.current && event.propertyName === 'height')
          unclip();
      }}
    >
      <div ref={content}>{children}</div>
    </div>
  );
}
