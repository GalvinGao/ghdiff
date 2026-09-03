import type { CSSProperties } from 'react';

import { cn } from '@/lib/cn';

// One bar of a skeleton: the shape of a line before the line arrives.
//
// It was a private helper in the pull request list, and the account panel needs
// the same bar — so it is stated once, the way `SectionLabel` is. A skeleton
// made of two slightly different greys reads as content rather than as a wait.
//
// `block` by default, because most bars are a line of their own. A bar standing
// in for text inside a real paragraph passes `inline-block align-middle`
// instead: that keeps the paragraph's own line box, so the placeholder is
// exactly as tall as the sentence it replaces.

export function SkeletonBar({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={cn('bg-line/70 block rounded', className)} style={style} />
  );
}
