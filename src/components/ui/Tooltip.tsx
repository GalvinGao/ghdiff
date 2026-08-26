import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

// A word for a control that is only a glyph.
//
// This is CSS and no JavaScript, the way `Dialog` is the platform's `<dialog>`:
// hover and focus are states the browser already tracks, and a library for them
// would be a dependency in the Worker's own graph, which has about 130 KiB of
// room left in it.
//
// The delay is on the shown state alone. `delay-500` under `group-hover` waits
// half a second before the tooltip appears, and the base `duration-100` with no
// delay takes it away the moment the pointer leaves — a tooltip that lingers is
// a tooltip in the way of the next thing the reviewer wants to press.
//
// The label is `aria-hidden`, because the control it belongs to carries the
// same words in its own `aria-label`. A screen reader that read both would say
// everything twice. And the control keeps no `title`: the browser draws that
// one itself, and the two would arrive together.

const SIDE = {
  bottom: 'top-full left-1/2 mt-1.5 -translate-x-1/2',
  right: 'left-full top-1/2 ml-1.5 -translate-y-1/2',
} as const;

export function Tooltip({
  children,
  className,
  label,
  side = 'bottom',
}: {
  children: ReactNode;
  className?: string;
  /** The same words the control's own `aria-label` carries. */
  label: string;
  side?: keyof typeof SIDE;
}) {
  return (
    <span className={cn('group/tooltip relative inline-flex', className)}>
      {children}
      <span
        aria-hidden="true"
        className={cn(
          'border-line bg-raised text-ink pointer-events-none absolute z-50',
          'rounded-md border px-1.5 py-1 text-xs whitespace-nowrap shadow-md',
          'opacity-0 transition-opacity duration-100',
          'group-hover/tooltip:opacity-100 group-hover/tooltip:delay-500',
          'group-has-[:focus-visible]/tooltip:opacity-100',
          'motion-reduce:transition-none',
          SIDE[side]
        )}
      >
        {label}
      </span>
    </span>
  );
}
