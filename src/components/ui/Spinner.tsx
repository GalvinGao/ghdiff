import { IconRefresh } from '@pierre/icons';

import { cn } from '@/lib/cn';

/**
 * Work that is already under way, next to the thing it is happening to. It is
 * for a list that is on screen and about to be replaced: the list stays
 * readable, and this says a newer answer is on its way. A panel that has
 * nothing to show yet says so in words instead.
 *
 * The glyph is mirrored and its animation runs backwards, so the arrowhead
 * leads. `motion-reduce` stops the turn, and the label carries the meaning for
 * a reader who cannot see either.
 */
export function Spinner({
  className,
  label,
  size = 12,
}: {
  className?: string;
  /** Read out when this appears. Name what is loading. */
  label: string;
  size?: number;
}) {
  return (
    <span
      aria-live="polite"
      className={cn('inline-flex shrink-0 items-center', className)}
      role="status"
    >
      <IconRefresh
        aria-hidden="true"
        className="text-ink-faint -scale-x-100 animate-spin [animation-direction:reverse] [animation-duration:1.2s] motion-reduce:animate-none"
        size={size}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
