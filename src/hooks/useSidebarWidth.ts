import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { readStoredJson, writeStoredString } from './useLocalStorage';
import { SIDEBAR_WIDTH_STORAGE_KEY } from '@/lib/storageKeys';

// How wide the sidebar is, and the drag that changes it.
//
// A drag renders nothing. Every pointermove writes the new width straight onto
// one custom property of the layout element, and React hears about it once,
// when the pointer comes up. The grid column and the handle both read that
// property, so the pane and the handle travel together while the diff beside
// them is never re-rendered or re-measured mid-drag. The drag's own look comes
// from a `data-resizing` attribute written to the DOM for the same reason.
//
// The width the reviewer chose and the width on screen are two different
// numbers. A container too narrow to hold both panes squeezes the sidebar, and
// widening it again gives the chosen width back: a container that is briefly
// narrow, which happens while a page loads, must not silently rewrite a
// setting.
//
// The room available is the width of the container the sidebar shares with the
// diff, not the width of the window. The left bar sits outside that container,
// so the window would over-report the room by the whole width of the bar, and
// collapsing the bar has to hand its space to the sidebar.

export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 720;
export const SIDEBAR_DEFAULT_WIDTH = 304;
/** The diff is the point of the page, so it keeps at least this much. */
const VIEWER_MIN_WIDTH = 360;
/** One arrow key press. */
const KEY_STEP = 16;

export const SIDEBAR_WIDTH_PROPERTY = '--reviewer-sidebar-width';

export interface SidebarWidthState {
  /**
   * Goes in the `ref` of the element that owns the grid columns. It is a
   * callback rather than a ref object, so nothing here is read while the
   * component that mounts it is rendering.
   */
  attachContainer(node: HTMLDivElement | null): void;
  /** The custom property the grid column reads. */
  style: CSSProperties;
  /** The width on screen, which is what the handle reports. */
  width: number;
  onHandlePointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onHandleKeyDown(event: ReactKeyboardEvent<HTMLElement>): void;
  reset(): void;
}

function clampWidth(value: number, available: number): number {
  const room = available - VIEWER_MIN_WIDTH;
  const max = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, room));
  return Math.round(Math.min(Math.max(value, SIDEBAR_MIN_WIDTH), max));
}

/** Wide enough for the whole range, for when there is nothing to measure. */
const UNCONSTRAINED = SIDEBAR_MAX_WIDTH + VIEWER_MIN_WIDTH;

export function useSidebarWidth(): SidebarWidthState {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  /**
   * How much room the two panes have between them. A container of zero says
   * there is nothing laid out yet, which happens before the first paint and in
   * a hidden browser tab, and that is not a layout to shrink into.
   */
  const availableWidth = useCallback((): number => {
    const width = containerRef.current?.clientWidth ?? 0;
    return width > 0 ? width : UNCONSTRAINED;
  }, []);

  // What is on screen. React only learns of a new value at the end of a drag.
  const [width, setWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  // The width the reviewer asked for, before the window had its say. It
  // survives a window too narrow to honour it.
  const chosenRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  // The width the DOM currently shows, which is ahead of React during a drag.
  const liveRef = useRef(SIDEBAR_DEFAULT_WIDTH);

  /** Paints a width without telling React about it. */
  const paint = useCallback((next: number) => {
    liveRef.current = next;
    containerRef.current?.style.setProperty(
      SIDEBAR_WIDTH_PROPERTY,
      `${String(next)}px`
    );
  }, []);

  /** Paints a width and tells React, so the handle reports the same number. */
  const apply = useCallback(
    (next: number) => {
      paint(next);
      setWidth(next);
    },
    [paint]
  );

  /** Records a width as the reviewer's own choice, and shows it. */
  const choose = useCallback(
    (next: number) => {
      chosenRef.current = next;
      writeStoredString(SIDEBAR_WIDTH_STORAGE_KEY, JSON.stringify(next));
      apply(next);
    },
    [apply]
  );

  // Read after mount, not during the first render, so the server markup and
  // the first client render agree.
  useEffect(() => {
    const stored = readStoredJson<number | null>(
      SIDEBAR_WIDTH_STORAGE_KEY,
      null
    );
    if (typeof stored !== 'number' || !Number.isFinite(stored)) return;
    chosenRef.current = stored;
    apply(clampWidth(stored, availableWidth()));
  }, [apply, availableWidth]);

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      // Only the primary button drags. The double click that resets the width
      // still reaches its own handler, because a drag of no distance commits
      // the width it started from.
      if (event.button !== 0) return;
      const handle = event.currentTarget;
      const startX = event.clientX;
      const startWidth = liveRef.current;
      // The property may still be coming from the inline style, so write it
      // here: from now until pointerup the DOM is the only place it lives.
      paint(startWidth);
      // Pointer capture keeps the events coming while the pointer travels over
      // the diff, which has handlers and a scroll region of its own.
      handle.setPointerCapture(event.pointerId);
      handle.dataset.resizing = 'true';
      // The pointer is over the diff for most of the drag, and the diff would
      // otherwise select its own code under it and show its own cursor.
      const body = document.body;
      const previousUserSelect = body.style.userSelect;
      const previousCursor = body.style.cursor;
      body.style.userSelect = 'none';
      body.style.cursor = 'col-resize';

      const onMove = (moveEvent: PointerEvent) => {
        paint(
          clampWidth(startWidth + moveEvent.clientX - startX, availableWidth())
        );
      };
      const onEnd = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onEnd);
        handle.removeEventListener('pointercancel', onEnd);
        delete handle.dataset.resizing;
        body.style.userSelect = previousUserSelect;
        body.style.cursor = previousCursor;
        choose(liveRef.current);
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onEnd);
      handle.addEventListener('pointercancel', onEnd);
    },
    [availableWidth, choose, paint]
  );

  const onHandleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const step =
        event.key === 'ArrowLeft'
          ? -KEY_STEP
          : event.key === 'ArrowRight'
            ? KEY_STEP
            : 0;
      if (step !== 0) {
        event.preventDefault();
        choose(clampWidth(liveRef.current + step, availableWidth()));
        return;
      }
      if (event.key === 'Home' || event.key === 'Enter') {
        event.preventDefault();
        choose(clampWidth(SIDEBAR_DEFAULT_WIDTH, availableWidth()));
      }
    },
    [availableWidth, choose]
  );

  const reset = useCallback(() => {
    choose(clampWidth(SIDEBAR_DEFAULT_WIDTH, availableWidth()));
  }, [availableWidth, choose]);

  /**
   * A container too narrow to hold both panes squeezes the sidebar. Widening
   * it, which is what collapsing the left bar does, gives the chosen width
   * back, and the choice itself is never rewritten. The painted width is the
   * only thing this compares, so a container resize inside the allowed range
   * re-renders nothing.
   */
  const fit = useCallback(() => {
    const room = containerRef.current?.clientWidth ?? 0;
    // Nothing is laid out yet, or the tab is hidden. The width stays put.
    if (room <= 0) return;
    const next = clampWidth(chosenRef.current, room);
    if (next === liveRef.current) return;
    apply(next);
  }, [apply]);

  /**
   * The container arrives through the `ref` of the element that owns the grid,
   * and the observer follows it. Observing the container rather than the window
   * is what makes the left bar's own width count: the bar sits outside this
   * element, so its width has already been taken out of what is measured here.
   * The container's width does not depend on the sidebar's, because the diff
   * column is `1fr`, so this can never chase its own tail.
   */
  const attachContainer = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      observerRef.current?.disconnect();
      if (node == null) {
        observerRef.current = null;
        return;
      }
      const observer = new ResizeObserver(fit);
      observer.observe(node);
      observerRef.current = observer;
      fit();
    },
    [fit]
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return {
    attachContainer,
    style: { [SIDEBAR_WIDTH_PROPERTY]: `${String(width)}px` } as CSSProperties,
    width,
    onHandlePointerDown,
    onHandleKeyDown,
    reset,
  };
}
