import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

// The one small-caps heading this app uses. It was copied into five files, and
// the copies had already started to drift apart.

export function SectionLabel({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'text-ink-faint text-[11px] font-semibold tracking-wide uppercase',
        className
      )}
      {...props}
    />
  );
}
