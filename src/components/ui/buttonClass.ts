import { cn } from '@/lib/cn';

// Every variant except `quiet` carries a border and a surface, so a control
// reads as a button before it is hovered. The header used to be a row of bare
// words that only looked clickable once the pointer was already on them.
//
// A button that holds a state says so. `data-[state=open]` is what Radix writes
// on the trigger of an open menu, and `aria-pressed` is what a toggle carries,
// so every menu trigger and every toggle in this app shows its state without
// each caller having to remember to style it.
//
// These are classes and nothing else, so a Link takes them as readily as a
// Button does.

export type ButtonVariant = 'solid' | 'outline' | 'danger' | 'quiet' | 'chrome';
export type ButtonSize = 'sm' | 'md' | 'icon' | 'icon-sm';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  solid:
    'border-accent bg-accent text-accent-ink shadow-sm hover:brightness-110 active:brightness-95',
  outline: [
    'border-line bg-raised text-ink shadow-sm hover:bg-surface hover:border-ink-faint active:bg-surface',
    'aria-pressed:bg-surface aria-pressed:border-ink-faint aria-pressed:shadow-none',
    'data-[state=open]:bg-surface data-[state=open]:border-ink-faint data-[state=open]:shadow-none',
  ].join(' '),
  danger:
    'border-line bg-raised text-removed shadow-sm hover:bg-removed/10 hover:border-removed/50',
  // For a row inside a menu, where a border on every item would be noise.
  quiet: [
    'border-transparent bg-transparent text-ink-muted hover:bg-surface hover:text-ink',
    'aria-pressed:bg-surface aria-pressed:text-ink',
    'data-[state=open]:bg-surface data-[state=open]:text-ink',
  ].join(' '),
  // For the header, which is itself `surface`: a control there cannot signal
  // hover by filling with the colour it already sits on, and a row of bordered
  // boxes across the top competes with the diff. It lifts to `raised` instead.
  chrome: [
    'border-transparent bg-transparent text-ink-muted hover:bg-raised hover:text-ink',
    'aria-pressed:bg-raised aria-pressed:text-ink',
    'data-[state=open]:bg-raised data-[state=open]:text-ink',
  ].join(' '),
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-2 text-xs',
  md: 'h-8 gap-1.5 px-3 text-sm',
  icon: 'size-8 justify-center',
  'icon-sm': 'size-7 justify-center',
};

/**
 * The button's own classes, for the few places where the control has to be an
 * anchor instead: a link that navigates must stay a link, and it should not
 * have to be dressed by hand to look like the buttons beside it.
 */
export function buttonClass(options?: {
  className?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
}): string {
  const { className, size = 'md', variant = 'outline' } = options ?? {};
  return cn(
    'inline-flex shrink-0 cursor-pointer items-center rounded-md border font-medium',
    'transition-[background-color,border-color,filter,box-shadow]',
    'focus-visible:ring-accent focus-visible:ring-2 focus-visible:ring-offset-1',
    'focus-visible:ring-offset-[var(--app-canvas)] focus-visible:outline-none',
    'disabled:pointer-events-none disabled:opacity-50',
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    className
  );
}
