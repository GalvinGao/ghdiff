/**
 * The colour scheme arrives as a circle growing from the press, and not as one
 * frame replacing another.
 *
 * A same-document view transition is what makes that possible: the outgoing
 * scheme is held on screen as the `::view-transition-old(root)` snapshot while
 * the incoming one is masked in above it, so the two schemes never cross-fade
 * as two flat pages. This module starts that transition and owns the three
 * lengths the mask reads; `src/globals.css` owns the shape, the feather and the
 * timing, under the `data-scheme-wipe` marker set here.
 *
 * The marker is what scopes all of it to this one transition. The
 * `::view-transition-*` pseudo-elements are the document's, not a component's,
 * so a navigation that is view-transitioned later must not inherit a theme
 * wipe.
 */

/** Viewport coordinates the wipe grows from: the press that changed the mode. */
export interface WipeOrigin {
  x: number;
  y: number;
}

/**
 * The parts of an activation `wipeOriginFromClick` reads. A React mouse event
 * and a DOM one both satisfy it, and so does a plain object in a test.
 */
export interface WipeActivation {
  detail: number;
  clientX: number;
  clientY: number;
  currentTarget: Pick<HTMLElement, 'getBoundingClientRect'>;
}

export interface ColorSchemeWipe {
  origin: WipeOrigin;
  /**
   * Whether the scheme on screen actually changes. A wipe between two
   * identical frames is half a second of blocked rendering for nothing, which
   * is what picking Light while Auto already resolves to light would cost.
   */
  changesScheme: boolean;
  /**
   * Applies the new mode, synchronously and completely: the attributes on the
   * document, and every React consumer of the scheme flushed into its new
   * state. The view transition captures the page as soon as this returns, so
   * anything left for a later render pops into place after the wipe rather
   * than arriving with it.
   */
  apply(): void;
}

// Two generations, because a press can supersede a wipe without starting one
// of its own.
//
// `latestRequest` counts every press and decides which one may still write the
// mode. `startViewTransition` returns before it runs the update callback, so a
// press made in that gap can resolve to the scheme already on screen, take the
// instant path, and be overwritten a moment later by the older callback — with
// the mode the reviewer had already moved off.
//
// `latestWipe` counts only the presses that started a wipe, and owns the marker
// and the three lengths. One counter cannot do both jobs: an instant press
// would revoke the running wipe's claim on the cleanup and leave all four
// stranded on the document element.
let latestRequest = 0;
let latestWipe = 0;

/**
 * `startViewTransition`, bound, or `null` where there is none.
 *
 * `lib.dom.d.ts` declares the method as always present and it is not: Firefox
 * ships no same-document view transitions, and no engine did before 2023.
 * Widening the read to include `undefined` puts the absent case in front of
 * the compiler, rather than leaving a check a later reader could mistake for
 * dead code.
 */
function viewTransitionStarter(): Document['startViewTransition'] | null {
  const start: Document['startViewTransition'] | undefined =
    document.startViewTransition;
  return typeof start === 'function' ? start.bind(document) : null;
}

function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The wipe origin for a press: the pointer, or the control's own centre when
 * the keyboard activated it. Enter and Space report `detail` 0 and coordinates
 * of 0,0, which would otherwise start every keyboard-driven wipe in the
 * top-left corner of the screen.
 */
export function wipeOriginFromClick(event: WipeActivation): WipeOrigin {
  if (event.detail > 0) {
    return { x: event.clientX, y: event.clientY };
  }
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * How far the circle has to travel: the distance from the origin to whichever
 * corner of the viewport is farthest from it. Anything short of that leaves a
 * corner in the scheme the reviewer just left. The feather's own overshoot is
 * added in the stylesheet.
 */
export function wipeReach(
  origin: WipeOrigin,
  width: number,
  height: number
): number {
  return Math.hypot(
    Math.max(origin.x, width - origin.x),
    Math.max(origin.y, height - origin.y)
  );
}

/**
 * Applies a colour mode behind a full-screen wipe: a feathered circle that
 * grows from `origin` and reveals the new scheme over a snapshot of the old
 * one.
 *
 * Applies it instantly instead when the browser has no view transitions, when
 * the reviewer asks for reduced motion, or when the scheme on screen does not
 * change. A press the reviewer has already moved off is dropped rather than
 * applied late — see the two generations above.
 */
export function applyColorSchemeWithWipe({
  apply,
  changesScheme,
  origin,
}: ColorSchemeWipe): void {
  const request = ++latestRequest;
  const startViewTransition = viewTransitionStarter();
  if (
    startViewTransition === null ||
    !changesScheme ||
    prefersReducedMotion()
  ) {
    apply();
    return;
  }

  const root = document.documentElement;
  const wipe = ++latestWipe;
  root.style.setProperty('--scheme-wipe-x', `${origin.x}px`);
  root.style.setProperty('--scheme-wipe-y', `${origin.y}px`);
  root.style.setProperty(
    '--scheme-wipe-reach',
    `${wipeReach(origin, window.innerWidth, window.innerHeight)}px`
  );
  root.dataset.schemeWipe = '';

  const transition = startViewTransition(() => {
    if (request !== latestRequest) {
      // A later press has already applied its own mode while this callback sat
      // queued. There is nothing left to reveal, so end the transition rather
      // than mask a frame that is not changing.
      transition.skipTransition();
      return;
    }
    apply();
  });

  const cleanup = (): void => {
    if (wipe !== latestWipe) return;
    delete root.dataset.schemeWipe;
    root.style.removeProperty('--scheme-wipe-x');
    root.style.removeProperty('--scheme-wipe-y');
    root.style.removeProperty('--scheme-wipe-reach');
  };
  // `finished` rejects when the update callback throws, so take both
  // settlements: the marker has to come off either way.
  void transition.finished.then(cleanup, cleanup);
}
