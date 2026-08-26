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

// How wide a pane is, and the drag that changes it.
//
// A drag renders nothing. Every pointermove writes the new width straight onto
// one custom property of the element that carries it, and React hears about it
// once, when the pointer comes up. The layout and the handle both read that
// property, so the pane and the handle travel together while whatever sits
// beside them is never re-rendered or re-measured mid-drag. The drag's own look
// comes from a `data-resizing` attribute written to the DOM for the same reason.
//
// The width the reviewer chose and the width on screen are two different
// numbers. A row too narrow to hold everything squeezes the pane, and widening
// it again gives the chosen width back: a row that is briefly narrow, which
// happens while a page loads, must not silently rewrite a setting.
//
// Two panes use this. The left bar is the element whose own width the drag
// sets, so its room is its parent's; the review sidebar is laid out inside the
// grid element that carries the property, so its room is that element's. That
// is the whole of `room`, and it decides what the ResizeObserver watches as
// well: a pane that watched the element it resizes would answer its own drag.

/** One arrow key press. */
const KEY_STEP = 16;

export interface PaneWidthOptions {
  defaultWidth: number;
  maxWidth: number;
  minWidth: number;
  /** The custom property the layout reads. */
  property: string;
  /** What everything to the right of the pane keeps, whatever a drag asks. */
  reserve: number;
  /**
   * Where the room comes from. `self` is for a pane laid out inside the element
   * that carries the property. `parent` is for a pane that *is* that element:
   * its own width is what the drag sets, so measuring it would chase its tail.
   */
  room: 'parent' | 'self';
  storageKey: string;
}

export interface PaneWidthState {
  /**
   * Goes in the `ref` of the element that carries the custom property. It is a
   * callback rather than a ref object, so nothing here is read while the
   * component that mounts it is rendering.
   */
  attach(node: HTMLElement | null): void;
  /** The custom property the layout reads. */
  style: CSSProperties;
  /** The width on screen, which is what the handle reports. */
  width: number;
  onHandlePointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onHandleKeyDown(event: ReactKeyboardEvent<HTMLElement>): void;
  reset(): void;
}

export function usePaneWidth(options: PaneWidthOptions): PaneWidthState {
  const {
    defaultWidth,
    maxWidth,
    minWidth,
    property,
    reserve,
    room,
    storageKey,
  } = options;

  const carrierRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const clampWidth = useCallback(
    (value: number, available: number): number => {
      const max = Math.max(minWidth, Math.min(maxWidth, available - reserve));
      return Math.round(Math.min(Math.max(value, minWidth), max));
    },
    [maxWidth, minWidth, reserve]
  );

  /** The element whose width says how much room there is to share. */
  const roomNode = useCallback((): HTMLElement | null => {
    const carrier = carrierRef.current;
    if (carrier == null) return null;
    return room === 'parent' ? carrier.parentElement : carrier;
  }, [room]);

  /**
   * How much room the panes have between them. A width of zero says there is
   * nothing laid out yet, which happens before the first paint and in a hidden
   * browser tab, and that is not a layout to shrink into. Wide enough for the
   * whole range is the answer then.
   */
  const availableWidth = useCallback((): number => {
    const width = roomNode()?.clientWidth ?? 0;
    return width > 0 ? width : maxWidth + reserve;
  }, [maxWidth, reserve, roomNode]);

  // What is on screen. React only learns of a new value at the end of a drag.
  const [width, setWidth] = useState(defaultWidth);
  // The width the reviewer asked for, before the window had its say. It
  // survives a window too narrow to honour it.
  const chosenRef = useRef(defaultWidth);
  // The width the DOM currently shows, which is ahead of React during a drag.
  const liveRef = useRef(defaultWidth);

  /** Paints a width without telling React about it. */
  const paint = useCallback(
    (next: number) => {
      liveRef.current = next;
      carrierRef.current?.style.setProperty(property, `${String(next)}px`);
    },
    [property]
  );

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
      writeStoredString(storageKey, JSON.stringify(next));
      apply(next);
    },
    [apply, storageKey]
  );

  // Read after mount, not during the first render, so the server markup and
  // the first client render agree.
  useEffect(() => {
    const stored = readStoredJson<number | null>(storageKey, null);
    if (typeof stored !== 'number' || !Number.isFinite(stored)) return;
    chosenRef.current = stored;
    apply(clampWidth(stored, availableWidth()));
  }, [apply, availableWidth, clampWidth, storageKey]);

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
      // the page, which has handlers and scroll regions of its own.
      handle.setPointerCapture(event.pointerId);
      handle.dataset.resizing = 'true';
      // The pointer is over the page for most of the drag, and the page would
      // otherwise select its own text under it and show its own cursor.
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
    [availableWidth, choose, clampWidth, paint]
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
        choose(clampWidth(defaultWidth, availableWidth()));
      }
    },
    [availableWidth, choose, clampWidth, defaultWidth]
  );

  const reset = useCallback(() => {
    choose(clampWidth(defaultWidth, availableWidth()));
  }, [availableWidth, choose, clampWidth, defaultWidth]);

  /**
   * A row too narrow to hold everything squeezes the pane. Widening it, which
   * is what collapsing the left bar does, gives the chosen width back, and the
   * choice itself is never rewritten. The painted width is the only thing this
   * compares, so a resize inside the allowed range re-renders nothing.
   */
  const fit = useCallback(() => {
    const available = roomNode()?.clientWidth ?? 0;
    // Nothing is laid out yet, or the tab is hidden. The width stays put.
    if (available <= 0) return;
    const next = clampWidth(chosenRef.current, available);
    if (next === liveRef.current) return;
    apply(next);
  }, [apply, clampWidth, roomNode]);

  /**
   * The carrier arrives through the `ref` of the element that owns the custom
   * property, and the observer follows whichever element holds the room. That
   * is never the pane itself, so this can never answer its own drag.
   */
  const attach = useCallback(
    (node: HTMLElement | null) => {
      carrierRef.current = node;
      observerRef.current?.disconnect();
      const measured = roomNode();
      if (measured == null) {
        observerRef.current = null;
        return;
      }
      const observer = new ResizeObserver(fit);
      observer.observe(measured);
      observerRef.current = observer;
      fit();
    },
    [fit, roomNode]
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return {
    attach,
    style: { [property]: `${String(width)}px` } as CSSProperties,
    width,
    onHandlePointerDown,
    onHandleKeyDown,
    reset,
  };
}
