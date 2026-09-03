import { IconCheck } from '@pierre/icons';
import type { ReactNode } from 'react';

import { SectionLabel } from '@/components/ui/SectionLabel';
import { cn } from '@/lib/cn';

// A numbered run of steps down a rail, where each one is behind us, in front of
// us, or the one to do now.
//
// Three states and not two. "Done" and "to do" alone would leave a reader
// scanning a list of identical rows for the one that wants them; the third state
// is the whole affordance, and it is what `aria-current="step"` says to a screen
// reader while the fill and the halo say it to everybody else.
//
// The marker is `absolute` and the row is padded past it, rather than the two
// sitting in a flex row. A step's body holds paragraphs, links and cards of its
// own, and every one of them has to start on the same left edge as the step's
// label — a flex row would indent the body by the marker's width plus a gap, and
// a body that wrapped would then hang under the marker instead of under itself.

export type StepStatus = 'done' | 'current' | 'upcoming';

/**
 * The dot in the rail: filled and ticked once a step is behind us, lit and haloed
 * on the one to do, hollow while it is still ahead.
 *
 * The halo is a second, expanding copy rather than an animated ring, so the pulse
 * costs one composited layer and never reflows the row it sits in. It is
 * `motion-safe` — a dot that throbs forever is exactly what a reader with
 * reduced motion set has asked not to see, and the fill alone still tells the
 * three states apart.
 *
 * The lit state is the accent, which in this app is ink rather than a hue. So the
 * rail reads as one quiet column and the diff beside it keeps every colour on the
 * screen, which is the rule the rest of the app holds to.
 */
function StepMarker({ status }: { status: StepStatus }) {
  return (
    <span
      aria-hidden="true"
      className="absolute top-[0.2rem] left-0 flex size-3 items-center justify-center"
    >
      {status === 'current' && (
        <span className="bg-accent/40 absolute inset-0 rounded-full motion-safe:animate-ping" />
      )}
      <span
        className={cn(
          'relative flex size-3 items-center justify-center rounded-full',
          status === 'upcoming' && 'bg-raised ring-line ring-1',
          status === 'done' && 'bg-ink-faint',
          status === 'current' && 'bg-accent ring-accent/25 ring-2'
        )}
      >
        {status === 'done' && <IconCheck className="text-raised" size={9} />}
      </span>
    </span>
  );
}

/**
 * One step: its number, what it is called, and whatever it takes to do it.
 *
 * The number is in the label rather than drawn in the marker. A marker is 12px
 * across and a digit inside one is unreadable at that size, and the marker
 * already carries the state — asking it to carry the ordering as well would cost
 * the tick, which is the clearer of the two.
 *
 * A step already behind us keeps its whole body rather than collapsing. Somebody
 * arriving late may still need to read what step one was, and a row that folds
 * away is a row they cannot check.
 */
export function Step({
  children,
  label,
  last = false,
  number,
  status,
}: {
  children?: ReactNode;
  label: string;
  /** True for the last step, which draws no connector below itself. */
  last?: boolean;
  number: number;
  status: StepStatus;
}) {
  return (
    <li
      aria-current={status === 'current' ? 'step' : undefined}
      className={cn('relative flex flex-col gap-1.5 pl-7', !last && 'pb-6')}
    >
      <StepMarker status={status} />
      {/* Drawn from under the marker to the row's foot, as a span rather than a
          border on the `li`: a border runs the row's whole height including the
          last one, which leaves a line hanging below the final marker with
          nothing under it. */}
      {!last && (
        <span
          aria-hidden="true"
          className="bg-line absolute top-4 bottom-0 left-[0.34rem] w-px"
        />
      )}
      <SectionLabel
        className={cn(status === 'upcoming' ? 'text-ink-faint' : 'text-ink')}
      >
        {number}. {label}
      </SectionLabel>
      {children}
    </li>
  );
}

/** The rail itself. An ordered list, because the order is the whole point. */
export function StepRail({ children }: { children: ReactNode }) {
  return <ol className="flex flex-col">{children}</ol>;
}

/**
 * An aside inside a step: the thing that is true but is not the instruction.
 *
 * `raised`, because a step's body sits directly on the page and the page is
 * `surface`. The two tones are the whole distance this app keeps between a card
 * and the page, and a box that took the page's own tone would be a rectangle
 * with nothing but a ring to say it was there — which is what this was, measured
 * at rgb(23,23,23) on an rgb(23,23,23) page.
 */
export function StepNote({ children }: { children: ReactNode }) {
  return (
    <div className="bg-raised ring-line mt-1 rounded-lg px-3 py-2.5 ring-1">
      <p className="text-ink-muted text-[13px]/[1.5]">{children}</p>
    </div>
  );
}
