'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'border-line bg-raised text-ink placeholder:text-ink-faint h-8 w-full rounded-md border px-2.5 text-sm',
        'focus-visible:border-accent focus-visible:ring-accent/40 focus-visible:ring-2 focus-visible:outline-none',
        className
      )}
      {...props}
    />
  );
});
