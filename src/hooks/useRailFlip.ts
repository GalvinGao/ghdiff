import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

// The collapse and the expand of the left bar, made continuous.
//
// The bar's width travels over 200 ms, but the two widths are two layouts, not
// one layout clipped: the wide bar left-aligns a square in a row of text, and
// the narrow bar centres the same square in a bare column. Swapping the layouts
// while the width travelled teleported every square in one frame, which is the
// one discontinuity a moving bar makes impossible to miss.
//
// So the toggle plays a FLIP. `beginToggle` reads where every marked element
// is — mid-animation positions included, so a second press mid-flight carries
// on from what is on screen — and after React commits the other layout, the
// effect below parks the bar at its destination width for one unpainted
// moment, reads where each element will land, and then flies each one from the
// old place to that landing.
//
// The flight's clock is the bar's own width, not a second animation. Every
// frame reads the width on screen, turns it into a progress — zero at the
// width the toggle left, one at the width it is going to — and puts every
// element exactly that fraction of the way along its line. An element the
// narrow bar centres or the wide bar right-aligns drifts with the width in
// between, and at 44px some of them sit clamped against content that cannot
// shrink; the per-frame write measures that drift and cancels it, so the glide
// is exact whatever the layout does mid-way. A transform animated on its own
// clock could not say the same: it is exact only where the resting position is
// affine in the width, and a clamped caption row is not. Driving off the width
// also means the flights cannot lag or lead it — pause the width and the
// squares stand still; change its curve and they follow — and a toggle pressed
// mid-toggle hands over cleanly, because the interrupted width restarts its
// curve from the width on screen and the new flight starts from the same
// measurement.
//
// The chrome around the squares — titles, headings, the footer — has no
// counterpart to fly to, so it crossfades instead: `beginToggle` also raises a
// ghost, an inert opaque copy of the layout being left, which the bar renders
// over the new layout and fades out over the same 200 ms. The flying elements
// are lifted above the ghost and hidden on it, so each square exists once to
// the eye. The ghost keeps its own scroll offset as a transform, because the
// copy does not scroll, and its own width, because the aside under it is
// already travelling toward the other one.

/**
 * How long the bar spends between its two widths, and the curve it travels on.
 * The aside's width transition and the ghost's fade both state them, and the
 * flights inherit whatever they state, because the width is their clock. (The
 * fade's curve is the one copy that cannot import this file: `rail-ghost-fade`
 * in globals.css.)
 *
 * The curve is ease-out with a whisper of spring: it crests well under 1%
 * past the target and settles back, so the bar lands rather than stops. The
 * flights read the width, so they carry the same overshoot, scaled to each
 * element's own distance — a square that travels 40px overshoots by a
 * fraction of a pixel, and the badge that crosses the whole bar by one or
 * two. The fade cannot follow past its end: opacity clamps at zero, so the
 * ghost is simply gone a touch before the settle, which leaves it to the
 * elements that can express it.
 */
export const RAIL_TRANSITION_MS = 200;
export const RAIL_TRANSITION_EASING = 'cubic-bezier(0.3, 1.15, 0.45, 1)';

// The `data-rail-flip` attribute marks an element that exists in both layouts
// and should fly between them. Its value is the identity that pairs the two
// renderings up.

/** The status square of one pull request, in either layout. */
export function railPullFlipKey(pull: {
  owner: string;
  repo: string;
  number: number;
}): string {
  return `pull:${pull.owner}/${pull.repo}#${String(pull.number)}`;
}

/** The layers badge of one stack, identified by the stack's root. */
export function railStackFlipKey(root: {
  owner: string;
  repo: string;
  number: number;
}): string {
  return `stack:${root.owner}/${root.repo}#${String(root.number)}`;
}

/** The collapse button itself, which trades corners when the bar toggles. */
export const RAIL_TOGGLE_FLIP_KEY = 'toggle';

/** The fading copy of the layout being left. */
export interface RailGhost {
  /** Which layout the copy repeats: true is the narrow column. */
  collapsed: boolean;
  /** Remounts the copy, so an interrupted fade restarts from opaque. */
  generation: number;
  /** The scroll offset the copy was read at, applied as a transform. */
  scrollTop: number;
  /** The bar's width when the copy was taken, in px. */
  width: number;
}

interface RailFlipCapture {
  /**
   * The square to hold still through the toggle. The two layouts disagree on
   * how tall the list is, so without an anchor a scrolled bar sends every
   * square on a long flight to a region the reviewer was not looking at. The
   * effect scrolls the new layout so this one square keeps its place on
   * screen, which turns every other flight into a short local one.
   */
  anchor: { key: string; offset: number } | null;
  rects: Map<string, DOMRect>;
}

interface RailFlipEntry {
  el: HTMLElement;
  key: string;
}

/** One element mid-flight: its two endpoints, and the transform it wears. */
interface RailFlight {
  el: HTMLElement;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Whether the endpoints ride the list's scroll, or sit in the chrome. */
  scrolls: boolean;
  appliedX: number;
  appliedY: number;
}

/**
 * Every marked element of the live layout, in document order. The ghost is a
 * second copy of the same markup, so its subtree is excluded.
 */
function flipEntries(root: HTMLElement): RailFlipEntry[] {
  const entries: RailFlipEntry[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('[data-rail-flip]')) {
    if (el.closest('[data-rail-ghost]') != null) continue;
    entries.push({ el, key: el.getAttribute('data-rail-flip') ?? '' });
  }
  return entries;
}

function centerOf(el: HTMLElement): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function useRailFlip({
  asideRef,
  collapsed,
  currentKey,
  scrollRef,
}: {
  asideRef: RefObject<HTMLElement | null>;
  /** The stored state; the effect fires on its change. */
  collapsed: boolean;
  /** The pull request under review, preferred as the scroll anchor. */
  currentKey?: string;
  scrollRef: RefObject<HTMLElement | null>;
}): {
  ghost: RailGhost | null;
  beginToggle(): void;
  clearGhost(): void;
} {
  const [ghost, setGhost] = useState<RailGhost | null>(null);
  const captureRef = useRef<RailFlipCapture | null>(null);
  const generationRef = useRef(0);
  /** Ends the flight under way, restoring every element it was moving. */
  const cancelFlightRef = useRef<(() => void) | null>(null);

  /**
   * Call in the toggle's own event handler, before setting the state, so the
   * rects read here are the layout being left.
   */
  const beginToggle = () => {
    const aside = asideRef.current;
    if (
      aside == null ||
      globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      // No motion: no capture and no ghost, and the effect below does nothing.
      // The aside's own transition is off under the same media query.
      captureRef.current = null;
      setGhost(null);
      return;
    }

    const entries = flipEntries(aside);
    const rects = new Map<string, DOMRect>();
    for (const { el, key } of entries)
      rects.set(key, el.getBoundingClientRect());

    let anchor: RailFlipCapture['anchor'] = null;
    const scroll = scrollRef.current;
    if (scroll != null) {
      const viewport = scroll.getBoundingClientRect();
      const inView = (rect: DOMRect | undefined): rect is DOMRect =>
        rect != null &&
        rect.bottom > viewport.top &&
        rect.top < viewport.bottom;
      const candidate =
        currentKey != null && inView(rects.get(currentKey))
          ? currentKey
          : entries.find(
              ({ key }) => key.startsWith('pull:') && inView(rects.get(key))
            )?.key;
      const rect = candidate == null ? undefined : rects.get(candidate);
      if (candidate != null && rect != null) {
        anchor = { key: candidate, offset: rect.top - viewport.top };
      }
    }

    captureRef.current = { anchor, rects };
    generationRef.current += 1;
    setGhost({
      collapsed,
      generation: generationRef.current,
      scrollTop: scroll?.scrollTop ?? 0,
      // clientWidth, not the rect's width: the copy sits inside the border,
      // and a toggle mid-toggle should copy the width on screen.
      width: aside.clientWidth,
    });
  };

  /** For the ghost's own animationend. A ghost that outstays is only invisible. */
  const clearGhost = useCallback(() => setGhost(null), []);

  // Runs on the first frame of the new layout, before it is painted.
  useLayoutEffect(() => {
    const capture = captureRef.current;
    if (capture == null) return;
    captureRef.current = null;
    const aside = asideRef.current;
    if (aside == null) return;

    // A toggle mid-toggle: the old rects above were read with the previous
    // flight's transforms still worn, so it ends here — after the capture,
    // before anything is measured — and hands over without a jump.
    cancelFlightRef.current?.();

    const entries = flipEntries(aside);
    const scroll = scrollRef.current;

    // Park the bar at its destination width for one unpainted moment and read
    // where everything lands. React has already written the destination into
    // the inline style; the transition is holding the rendered width back, so
    // it is turned off for the reads and replayed afterwards. Nothing paints
    // until this effect returns, so the round trip is invisible.
    const fromWidth = aside.getBoundingClientRect().width;
    const destinationStyle = aside.style.width;
    aside.style.transitionProperty = 'none';
    const toWidth = aside.getBoundingClientRect().width;

    // Anchoring belongs in the parked layout too: the browser clamps
    // scrollTop, and it must clamp against the layout being landed in.
    const anchor = capture.anchor;
    if (scroll != null && anchor != null) {
      const target = entries.find((entry) => entry.key === anchor.key);
      if (target != null) {
        const viewport = scroll.getBoundingClientRect();
        const rect = target.el.getBoundingClientRect();
        scroll.scrollTop += rect.top - viewport.top - anchor.offset;
      }
    }
    const settledScrollTop = scroll?.scrollTop ?? 0;

    const flights: RailFlight[] = [];
    for (const { el, key } of entries) {
      const before = capture.rects.get(key);
      if (before == null) continue;
      const from = {
        x: before.left + before.width / 2,
        y: before.top + before.height / 2,
      };
      // Centre to centre: the two renderings of a square are the same size,
      // but the boxes marked around them are not always.
      const to = centerOf(el);
      if (Math.abs(to.x - from.x) < 0.5 && Math.abs(to.y - from.y) < 0.5) {
        continue;
      }
      flights.push({
        el,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
        scrolls: scroll != null && scroll.contains(el),
        appliedX: 0,
        appliedY: 0,
      });
    }

    // Replay the width from where the toggle found it. This is the same
    // restart an interrupted CSS transition performs on its own; stating it
    // makes the parked reads above free.
    aside.style.width = `${String(fromWidth)}px`;
    void aside.offsetWidth;
    aside.style.transitionProperty = '';
    aside.style.width = destinationStyle;

    if (flights.length === 0) return;

    const span = toWidth - fromWidth;
    let raf = 0;

    const settle = () => {
      cancelAnimationFrame(raf);
      cancelFlightRef.current = null;
      for (const flight of flights) {
        flight.el.style.transform = '';
        flight.el.style.position = '';
        flight.el.style.zIndex = '';
      }
    };
    cancelFlightRef.current = settle;

    // Nothing for the transition to travel: land everything now. Unreachable
    // while the two widths differ, and the loop below would otherwise wait on
    // a transition that never forms.
    if (Math.abs(span) < 1) {
      settle();
      return;
    }

    /**
     * Whether the aside's width is still in transit. This — not the progress —
     * is what says the flight is over: a springy curve carries the width
     * through its target and back, so the first frame at 1 is the crest of the
     * settle, not the end of it. The animation list is asked rather than
     * `transitionend` listened for, because it also answers for a transition
     * that was cancelled mid-way — a drag or a media-query flip turning
     * `transition-property` off — and it answers synchronously, where the
     * event waits on a rendering step.
     */
    const widthInTransit = () =>
      aside
        .getAnimations()
        .some(
          (animation) =>
            animation instanceof CSSTransition &&
            animation.transitionProperty === 'width'
        );

    // One frame: read the bar's width, turn it into the flight's progress, and
    // put every element that fraction of the way along its line. The reads all
    // come before the writes, so the frame costs one layout. `applied` is the
    // transform an element already wears; subtracting it recovers where the
    // layout itself put the element this frame, drift, clamp and all. The
    // progress is unclamped above one on purpose: the width overshoots its
    // target and returns, and each element follows through past its landing by
    // the same fraction of its own line.
    const step = () => {
      const width = aside.getBoundingClientRect().width;
      const progress = Math.max(0, (width - fromWidth) / span);
      // A scroll mid-flight moves the list under the flights; both endpoints
      // ride along, or the squares would hang in the viewport while their
      // rows left.
      const scrolled = scroll == null ? 0 : settledScrollTop - scroll.scrollTop;
      const measured = flights.map((flight) => centerOf(flight.el));
      flights.forEach((flight, index) => {
        const at = measured[index];
        const drift = flight.scrolls ? scrolled : 0;
        const targetX =
          flight.toX + (flight.fromX - flight.toX) * (1 - progress);
        const targetY =
          flight.toY +
          (flight.fromY - flight.toY) * (1 - progress) +
          drift * Math.min(1, progress);
        const nextX = targetX - (at.x - flight.appliedX);
        const nextY = targetY - (at.y - flight.appliedY);
        flight.appliedX = nextX;
        flight.appliedY = nextY;
        flight.el.style.transform = `translate(${String(nextX)}px, ${String(nextY)}px)`;
      });
      if (!widthInTransit()) {
        settle();
        return;
      }
      raf = requestAnimationFrame(step);
    };

    // Above the ghost (z-10) for the flight, so a square is never a frame
    // behind the opaque copy of the layout it left.
    for (const flight of flights) {
      flight.el.style.position = 'relative';
      flight.el.style.zIndex = '30';
    }
    // The first frame runs now, inside the effect, so the elements are already
    // on their starting marks when this commit paints.
    step();
    // `collapsed` is the toggle this reacts to; the two refs are stable
    // containers, listed because one dependency rule demands them while the
    // other objects to them.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [asideRef, collapsed, scrollRef]);

  // The bar can unmount mid-flight — the watch list emptied, the app closed a
  // pane — and the frame loop must not outlive it.
  useEffect(() => () => cancelFlightRef.current?.(), []);

  return { ghost, beginToggle, clearGhost };
}
