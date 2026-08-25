import {
  type ButtonHTMLAttributes,
  createContext,
  type ReactNode,
  useContext,
} from 'react';

import { cn } from '@/lib/cn';

// One choice out of a short list, where the choices are worth showing at once.
// The unselected items carry no surface of their own, so the group reads as one
// control on the chrome and only the chosen item lifts off it.

interface SegmentedContextValue {
  onValueChange(value: string): void;
  value: string;
}

const SegmentedContext = createContext<SegmentedContextValue | null>(null);

interface SegmentedProps {
  'aria-label': string;
  children: ReactNode;
  className?: string;
  onValueChange(value: string): void;
  value: string;
}

export function Segmented({
  'aria-label': ariaLabel,
  children,
  className,
  onValueChange,
  value,
}: SegmentedProps) {
  return (
    <SegmentedContext.Provider value={{ onValueChange, value }}>
      <div
        role="group"
        aria-label={ariaLabel}
        className={cn('inline-flex items-center gap-0.5', className)}
      >
        {children}
      </div>
    </SegmentedContext.Provider>
  );
}

interface SegmentedItemProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'value'
> {
  value: string;
}

export function SegmentedItem({
  children,
  className,
  value,
  onClick,
  ...props
}: SegmentedItemProps) {
  const context = useContext(SegmentedContext);
  if (context == null) {
    throw new Error('SegmentedItem must be rendered inside a Segmented');
  }
  const selected = context.value === value;
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2',
        'text-xs font-medium transition-[background-color,border-color,color,box-shadow]',
        'focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none',
        selected
          ? 'border-line bg-raised text-ink shadow-sm'
          : 'text-ink-muted hover:bg-raised hover:text-ink border-transparent',
        className
      )}
      onClick={(event) => {
        context.onValueChange(value);
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * A count that belongs to a segment. It takes its tint from the text colour it
 * sits next to, so it stays legible in both the selected and unselected state.
 */
export function SegmentedCount({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[color-mix(in_srgb,currentcolor_16%,transparent)] px-1 text-[10px] leading-none tabular-nums">
      {children}
    </span>
  );
}
