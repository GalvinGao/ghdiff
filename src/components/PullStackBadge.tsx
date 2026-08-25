import { IconLayers } from '@pierre/icons';

import { cn } from '@/lib/cn';

/**
 * How many pull requests one stack chains together: the layers glyph, and the
 * count beside it.
 *
 * A stack is the shape a reviewer wants before they read a single title, and it
 * was the one thing the collapsed bar could not say — a column of status squares
 * gave no hint that three of them were one chain. This badge, and the block
 * drawn behind the rows it belongs to, are the whole of what says so. Both bar
 * widths use both, so the wide bar and the narrow one report the same stacks.
 */
export function PullStackBadge({
  className,
  size,
}: {
  className?: string;
  size: number;
}) {
  const label = `A stack of ${String(size)} pull requests`;
  return (
    <span
      aria-label={label}
      className={cn(
        'text-ink-faint inline-flex shrink-0 items-center gap-0.5 text-[10px] leading-none tabular-nums',
        className
      )}
      title={label}
    >
      <IconLayers size={9} />
      {size}
    </span>
  );
}
