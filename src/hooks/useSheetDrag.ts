import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';

// A sheet follows the finger down and goes when it is let go far enough.
//
// That is the whole of what makes a bottom sheet read as one on a phone: a
// window anchored to the bottom edge that ignores a downward swipe is a dialog
// in the wrong place, and the reviewer's thumb is already on it. So the sheet
// tracks the gesture one to one, and the release decides — past `DISMISS_AT` of
// its own height, or thrown downward faster than `FLICK_SPEED`, it leaves;
// anything less and it settles back.
//
// Two gestures start a drag, and they need two kinds of event. The title bar is
// `touch-action: none`, so the browser claims nothing there and pointer events
// cover a finger and a mouse alike. The body scrolls, and a scroll region is one
// the browser claims for itself — the moment a finger moves on it, the pointer
// stream ends in `pointercancel`. Touch events are the only ones a page can
// still `preventDefault` there, so a pull down on a list already at its top is
// read from those, which is the second way iOS lets a sheet go.
//
// Every frame of the drag is written onto the nodes and React is told nothing,
// the way `usePaneWidth` writes a pane's width. The figure goes three places:
// the sheet's own `transform`, and `--sheet-drag` on the document element, a
// fraction from 0 to 1 that the backdrop and the page pushed back behind the
// sheet both read to come forward with it. `data-sheet-dragging` on both takes
// their transitions off for the length of the gesture, or each would trail the
// finger by its own easing.
//
// The release that dismisses leaves the sheet's transform at the bottom edge
// rather than clearing it. Clearing it would hand the box back to its open
// position for the frame before React closes the dialog, and the slide down
// would start with a twitch up.

/** Of the sheet's own height: let go past this and it leaves. */
const DISMISS_AT = 0.35;

/** Pixels per millisecond downward. A flick this fast leaves from anywhere. */
const FLICK_SPEED = 0.5;

/** How far back the release reads the finger's speed from. */
const VELOCITY_WINDOW_MS = 80;

/** A finger that has moved this far is a gesture rather than a press. */
const SLOP = 4;

interface Sample {
  y: number;
  t: number;
}

export function useSheetDrag(
  ref: RefObject<HTMLDialogElement | null>,
  enabled: boolean,
  onDismiss: () => void
) {
  // Read through a ref, so a new callback from each render does not tear the
  // listeners down and lose a gesture under way.
  const dismissRef = useRef(onDismiss);
  useLayoutEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const sheet = ref.current;
    if (!enabled || sheet == null) return;
    const root = document.documentElement;

    let startY = 0;
    let samples: Sample[] = [];
    let height = 1;

    function begin(y: number) {
      startY = y;
      samples = [{ y, t: performance.now() }];
      height = Math.max(1, sheet!.getBoundingClientRect().height);
      sheet!.setAttribute('data-sheet-dragging', '');
      root.setAttribute('data-sheet-dragging', '');
    }

    function move(y: number) {
      const offset = Math.max(0, y - startY);
      const now = performance.now();
      samples.push({ y, t: now });
      while (samples.length > 2 && now - samples[0].t > VELOCITY_WINDOW_MS) {
        samples.shift();
      }
      sheet!.style.transform = `translateY(${offset}px)`;
      root.style.setProperty(
        '--sheet-drag',
        String(Math.min(1, offset / height))
      );
    }

    function end() {
      const last = samples.at(-1);
      const first = samples[0];
      const offset = last == null ? 0 : Math.max(0, last.y - startY);
      const elapsed = last != null && first != null ? last.t - first.t : 0;
      const speed = elapsed > 0 ? (last!.y - first.y) / elapsed : 0;
      const dismiss =
        offset > height * DISMISS_AT || (speed > FLICK_SPEED && offset > SLOP);

      sheet!.removeAttribute('data-sheet-dragging');
      root.removeAttribute('data-sheet-dragging');
      root.style.removeProperty('--sheet-drag');
      samples = [];
      if (dismiss) {
        sheet!.style.transform = 'translateY(100%)';
        dismissRef.current();
      } else {
        sheet!.style.removeProperty('transform');
      }
    }

    // The title bar: pointer events, captured, so a drag that leaves the bar
    // keeps reporting. A press that starts on one of the bar's own controls is
    // that control's and not a drag.
    let pointerId: number | null = null;

    function onPointerDown(event: PointerEvent) {
      const handle = (event.target as Element).closest('[data-sheet-handle]');
      if (handle == null || !sheet!.contains(handle)) return;
      if ((event.target as Element).closest('button, a, input')) return;
      if (event.button !== 0) return;
      pointerId = event.pointerId;
      (handle as HTMLElement).setPointerCapture(event.pointerId);
      begin(event.clientY);
    }

    function onPointerMove(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      move(event.clientY);
    }

    function onPointerUp(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      end();
    }

    // The body: touch events, and only from a list already scrolled to its top.
    // A swipe that starts anywhere else is a scroll and stays one, and a swipe
    // up from the top is a scroll as well — the sheet has no taller size to go
    // to.
    let touchStartY: number | null = null;
    let touchEngaged = false;

    function onTouchStart(event: TouchEvent) {
      touchStartY = null;
      touchEngaged = false;
      if (event.touches.length !== 1) return;
      if ((event.target as Element).closest('[data-sheet-handle]')) return;
      if (sheet!.scrollTop > 0) return;
      touchStartY = event.touches[0].clientY;
    }

    function onTouchMove(event: TouchEvent) {
      if (touchStartY == null) return;
      const y = event.touches[0].clientY;
      if (!touchEngaged) {
        const dy = y - touchStartY;
        if (dy < -SLOP || sheet!.scrollTop > 0) {
          touchStartY = null;
          return;
        }
        if (dy <= SLOP) return;
        touchEngaged = true;
        begin(y);
      }
      if (event.cancelable) event.preventDefault();
      move(y);
    }

    function onTouchEnd() {
      if (touchEngaged) end();
      touchStartY = null;
      touchEngaged = false;
    }

    sheet.addEventListener('pointerdown', onPointerDown);
    sheet.addEventListener('pointermove', onPointerMove);
    sheet.addEventListener('pointerup', onPointerUp);
    sheet.addEventListener('pointercancel', onPointerUp);
    sheet.addEventListener('touchstart', onTouchStart, { passive: true });
    // Not passive: this listener is the one that may cancel the scroll.
    sheet.addEventListener('touchmove', onTouchMove, { passive: false });
    sheet.addEventListener('touchend', onTouchEnd);
    sheet.addEventListener('touchcancel', onTouchEnd);
    return () => {
      sheet.removeEventListener('pointerdown', onPointerDown);
      sheet.removeEventListener('pointermove', onPointerMove);
      sheet.removeEventListener('pointerup', onPointerUp);
      sheet.removeEventListener('pointercancel', onPointerUp);
      sheet.removeEventListener('touchstart', onTouchStart);
      sheet.removeEventListener('touchmove', onTouchMove);
      sheet.removeEventListener('touchend', onTouchEnd);
      sheet.removeEventListener('touchcancel', onTouchEnd);
      sheet.removeAttribute('data-sheet-dragging');
      root.removeAttribute('data-sheet-dragging');
      root.style.removeProperty('--sheet-drag');
    };
  }, [enabled, ref]);
}
