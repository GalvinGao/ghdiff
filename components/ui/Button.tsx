'use client';

import { type ButtonHTMLAttributes, forwardRef } from 'react';

import { cn } from '@/lib/cn';

// Every variant except `quiet` carries a border and a surface, so a control
// reads as a button before it is hovered. The header used to be a row of bare
// words that only looked clickable once the pointer was already on them.

type Variant = 'solid' | 'outline' | 'danger' | 'quiet';
type Size = 'sm' | 'md' | 'icon';

const VARIANT_CLASS: Record<Variant, string> = {
  solid:
    'border-accent bg-accent text-accent-ink shadow-sm hover:brightness-110 active:brightness-95',
  outline:
    'border-line bg-raised text-ink shadow-sm hover:bg-surface hover:border-ink-faint active:bg-surface',
  danger:
    'border-line bg-raised text-removed shadow-sm hover:bg-removed/10 hover:border-removed/50',
  // For a row inside a menu, where a border on every item would be noise.
  quiet:
    'border-transparent bg-transparent text-ink-muted hover:bg-surface hover:text-ink',
};

const SIZE_CLASS: Record<Size, string> = {
  sm: 'h-7 gap-1.5 px-2 text-xs',
  md: 'h-8 gap-1.5 px-3 text-sm',
  icon: 'size-8 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = 'outline', size = 'md', ...props },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={props.type ?? 'button'}
        className={cn(
          'inline-flex shrink-0 cursor-pointer items-center rounded-md border font-medium',
          'transition-[background-color,border-color,filter,box-shadow]',
          'focus-visible:ring-accent focus-visible:ring-2 focus-visible:ring-offset-1',
          'focus-visible:ring-offset-[var(--app-canvas)] focus-visible:outline-none',
          'disabled:pointer-events-none disabled:opacity-50',
          VARIANT_CLASS[variant],
          SIZE_CLASS[size],
          className
        )}
        {...props}
      />
    );
  }
);
