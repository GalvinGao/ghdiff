import { IconArrowUpRight } from '@pierre/icons';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

// The two ways this app sends a reviewer to github.com.
//
// Both open a new tab. ghdiff is a place a reviewer stays: the diff they are
// reading holds a scroll position, a filter and a fragment, and a link that
// replaced it with github.com would throw all three away to answer one
// question. `rel="noreferrer"` goes with `target="_blank"` as a matter of
// course — it is what keeps the opened page from reaching back through
// `window.opener`.

const NEW_TAB = { rel: 'noreferrer', target: '_blank' } as const;

/**
 * A name on screen that is also a page on GitHub. It reads as the text it
 * replaces until the pointer is on it, because a heading underlined at rest is
 * a heading that has stopped being a heading.
 */
export function GitHubTextLink({
  children,
  className,
  href,
  title,
}: {
  children: ReactNode;
  className?: string;
  href: string;
  title: string;
}) {
  return (
    <a
      {...NEW_TAB}
      className={cn(
        'hover:text-ink hover:underline hover:decoration-dotted hover:underline-offset-2',
        'focus-visible:ring-accent rounded-xs focus-visible:ring-1 focus-visible:outline-none',
        className
      )}
      href={href}
      title={title}
    >
      {children}
    </a>
  );
}

/**
 * The same journey as a glyph, for a row whose text belongs to something else.
 * It is invisible until the row is hovered or the button itself is focused: an
 * arrow on every author of every repository would be a column of arrows, and
 * the bar is a list of pull requests, not a list of links.
 *
 * The row it belongs to has to carry `group` for that to work, and the button
 * keeps its own space either way, so no row moves when one appears.
 */
export function GitHubIconLink({
  className,
  href,
  label,
}: {
  className?: string;
  href: string;
  label: string;
}) {
  return (
    <a
      {...NEW_TAB}
      aria-label={label}
      className={cn(
        'text-ink-faint hover:text-ink hover:bg-raised flex size-4 shrink-0 items-center justify-center rounded-sm',
        'opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-visible:opacity-100',
        'focus-visible:ring-accent focus-visible:ring-1 focus-visible:outline-none',
        'motion-reduce:transition-none',
        className
      )}
      href={href}
      title={label}
    >
      <IconArrowUpRight size={11} />
    </a>
  );
}
