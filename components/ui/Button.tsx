'use client';

import { type ButtonHTMLAttributes, forwardRef } from 'react';

import { cn } from '@/lib/cn';

type Variant = 'solid' | 'ghost' | 'outline' | 'danger';
type Size = 'sm' | 'md' | 'icon';

const VARIANT_CLASS: Record<Variant, string> = {
  solid: 'bg-accent text-accent-ink hover:opacity-90',
  ghost: 'text-ink-muted hover:bg-surface hover:text-ink',
  outline: 'border border-line text-ink hover:bg-surface',
  danger: 'text-removed hover:bg-removed/10',
};

const SIZE_CLASS: Record<Size, string> = {
  sm: 'h-6 gap-1 px-2 text-xs',
  md: 'h-8 gap-1.5 px-3 text-sm',
  icon: 'size-7 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = 'ghost', size = 'md', ...props },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={props.type ?? 'button'}
        className={cn(
          'inline-flex shrink-0 cursor-pointer items-center rounded-md font-medium transition',
          'focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none',
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
