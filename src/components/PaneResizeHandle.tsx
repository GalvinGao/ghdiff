import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

import { cn } from '@/lib/cn';

// The seam at the edge of a resizable pane.
//
// It sits over the pane's own right border rather than taking a column of its
// own, so nothing moves when it is grabbed and the two panes still meet on one
// line. The line is one pixel and the grab area is eight, which is the smallest
// target a pointer finds without aiming for it.
//
// It takes the values it needs one by one, rather than a whole state object, so
// the drag's internals stay inside the hook. `style` is how it is placed,
// because the two panes anchor it differently: the sidebar is a grid column and
// names its width property, while the left bar is the element itself and hangs
// the handle off its own right edge.

interface PaneResizeHandleProps {
  /** Names the pane whose width this sets, for a screen reader. */
  label: string;
  max: number;
  min: number;
  onKeyDown(event: ReactKeyboardEvent<HTMLElement>): void;
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onReset(): void;
  /** Where the seam sits. One of `left` or `right`, and nothing else. */
  style: CSSProperties;
  width: number;
}

export function PaneResizeHandle({
  label,
  max,
  min,
  onKeyDown,
  onPointerDown,
  onReset,
  style,
  width,
}: PaneResizeHandleProps) {
  return (
    <div
      // A separator is what this is, and the value it reports is the width of
      // the pane before it.
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize. Double click to reset."
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      style={style}
      className={cn(
        'group absolute inset-y-0 z-20 w-2 cursor-col-resize touch-none select-none',
        'focus-visible:outline-none'
      )}
    >
      {/* The bar inside is what lights up. The handle itself stays invisible
          until it is wanted, because a permanent vertical rule beside a diff
          reads as another column of content. */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 left-[3px] w-0.5 rounded-full',
          'bg-accent opacity-0 transition-opacity duration-100',
          'group-hover:opacity-70 group-focus-visible:opacity-100',
          // Written straight to the DOM by the drag, which renders nothing.
          'group-data-[resizing]:opacity-100'
        )}
      />
    </div>
  );
}
