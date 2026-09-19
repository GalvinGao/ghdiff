import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '@/lib/cn';

/**
 * The box this app says something in when there is no diff on screen: a patch
 * still arriving, one that would not load, and the `ghdiff` command's own "this
 * page did not come from a running server".
 *
 * Everything passed lands on the inner box, so a caller that is announcing
 * something states its `role` and `aria-live` where a screen reader finds them.
 *
 * `NotFound` deliberately does not use this: it is a whole page rather than a
 * panel in one — a `<main>` landmark painting its own background, with no
 * `min-h-0` — which is a different thing that reads similarly.
 */
export function CenteredNotice({
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<'section'>) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <section className={cn('max-w-md text-center', className)} {...rest}>
        {children}
      </section>
    </div>
  );
}
