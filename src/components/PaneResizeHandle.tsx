import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

import { cn } from '@/lib/cn';
import { m } from '@/paraglide/messages.js';

// The seam at the edge of a resizable pane.
//
// It sits over the pane's own border rather than taking a track of its own, so
// nothing moves when it is grabbed and the two panes still meet on one line.
// The line is one pixel and the grab area is eight, which is the smallest
// target a pointer finds without aiming for it.
//
// It takes the values it needs one by one, rather than a whole state object, so
// the drag's internals stay inside the hook. `style` is how it is placed,
// because the panes anchor it differently: the sidebar is a grid track and
// names its size property, while the left bar is the element itself and hangs
// the handle off its own right edge.
//
// `orientation` is the seam's own direction: `vertical` (the default) is the
// seam between two columns and drags a width; `horizontal` is the seam between
// two rows — the sidebar as a band above the diff on a portrait screen — and
// drags a height.

interface PaneResizeHandleProps {
  /** Names the pane whose size this sets, for a screen reader. */
  label: string;
  max: number;
  min: number;
  onKeyDown(event: ReactKeyboardEvent<HTMLElement>): void;
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onReset(): void;
  /** The seam's direction. Defaults to `vertical`. */
  orientation?: 'vertical' | 'horizontal';
  /** Where the seam sits. One of `left`, `right` or `top`, and nothing else. */
  style: CSSProperties;
  width: number;
  /** Visibility rules, which are the caller's: which layout shows this seam. */
  className?: string;
}

export function PaneResizeHandle({
  label,
  max,
  min,
  onKeyDown,
  onPointerDown,
  onReset,
  orientation = 'vertical',
  style,
  width,
  className,
}: PaneResizeHandleProps) {
  const horizontal = orientation === 'horizontal';
  return (
    <div
      // A separator is what this is, and the value it reports is the size of
      // the pane before it.
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={m.pane_resize_handle_drag_to_resize_double_click_to_reset()}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      style={style}
      className={cn(
        'group absolute z-20 touch-none select-none',
        horizontal
          ? 'inset-x-0 h-2 cursor-row-resize'
          : 'inset-y-0 w-2 cursor-col-resize',
        'focus-visible:outline-none',
        className
      )}
    >
      {/* The bar inside is what lights up. The handle itself stays invisible
          until it is wanted, because a permanent rule beside a diff reads as
          another column of content. */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute rounded-full',
          horizontal
            ? 'inset-x-0 top-[3px] h-0.5'
            : 'inset-y-0 left-[3px] w-0.5',
          'bg-accent opacity-0 transition-opacity duration-100',
          'group-hover:opacity-70 group-focus-visible:opacity-100',
          // Written straight to the DOM by the drag, which renders nothing.
          'group-data-[resizing]:opacity-100'
        )}
      />
    </div>
  );
}
