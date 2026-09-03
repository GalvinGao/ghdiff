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

// `bottom-end` anchors the label's right edge to the control's, rather than
// centring it. A centred label on a control near the right edge of a narrow
// container hangs outside it — and a container with `overflow-y-auto` has an
// `overflow-x` of `auto` whether it asked for one or not, so what hangs out
// becomes a horizontal scrollbar across the whole thing.
const SIDE = {
  bottom: 'top-full left-1/2 mt-1.5 -translate-x-1/2',
  right: 'left-full top-1/2 ml-1.5 -translate-y-1/2',
  // For a control on the last row of a scrolling box. Below it is outside the
  // content, which a container with `overflow-y-auto` clips; above it is inside.
  // `right-0` rather than a centred label, because a centred one on a control
  // near the right edge hangs out the side — and an `overflow-y-auto` box has an
  // `overflow-x` of `auto` whether it asked for one or not, so what hangs out
  // becomes a horizontal scrollbar across the whole thing.
  'top-end': 'bottom-full right-0 mb-1.5',
} as const;

export function Tooltip({
  children,
  className,
  label,
  side = 'bottom',
  wide = false,
}: {
  children: ReactNode;
  className?: string;
  /** The same words the control's own `aria-label` carries. */
  label: string;
  side?: keyof typeof SIDE;
  /**
   * For a label that is a sentence rather than a name. A glyph's tooltip is two
   * or three words and must not wrap; a reason a control is unavailable can run
   * to sixty characters, and on one line that is wider than the dialog it sits
   * in.
   */
  wide?: boolean;
}) {
  return (
    <span className={cn('group/tooltip relative inline-flex', className)}>
      {children}
      <span
        aria-hidden="true"
        className={cn(
          'border-line bg-raised text-ink pointer-events-none absolute z-50',
          'rounded-md border px-1.5 py-1 text-xs shadow-md',
          wide ? 'w-52 text-pretty' : 'whitespace-nowrap',
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
