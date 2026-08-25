import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_PROPERTY,
} from '@/hooks/useSidebarWidth';
import { cn } from '@/lib/cn';

// The seam between the sidebar and the diff.
//
// It sits over the sidebar's own right border rather than taking a column of
// its own, so nothing moves when it is grabbed and the two panes still meet on
// one line. The line is one pixel and the grab area is eight, which is the
// smallest target a pointer finds without aiming for it.
//
// It takes the four values it needs one by one, rather than the whole state
// object, so the drag's internals stay inside the hook.

interface SidebarResizeHandleProps {
  onKeyDown(event: ReactKeyboardEvent<HTMLElement>): void;
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onReset(): void;
  width: number;
}

export function SidebarResizeHandle({
  onKeyDown,
  onPointerDown,
  onReset,
  width,
}: SidebarResizeHandleProps) {
  return (
    <div
      // A separator is what this is, and the value it reports is the width of
      // the pane before it.
      role="separator"
      aria-orientation="vertical"
      aria-label="Sidebar width"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={0}
      title="Drag to resize. Double click to reset."
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      style={{ left: `calc(var(${SIDEBAR_WIDTH_PROPERTY}) - 4px)` }}
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
