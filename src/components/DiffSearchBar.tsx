import { IconChevron, IconX } from '@pierre/icons';

import { Button } from '@/components/ui/Button';
import { SearchField } from '@/components/ui/SearchField';
import type { DiffSearchState } from '@/hooks/useDiffSearch';
import { cn } from '@/lib/cn';

// Find in diff, as a strip above the diff.
//
// A strip and not a floating panel, for the reason the sidebar's path search
// is a strip under its own controls: a panel over the top-right of the diff
// would sit on the sticky header's Viewed toggle for as long as it was open.
// The strip takes its row from the diff instead, and the viewer measures
// itself again the way it does for any resize.
//
// It is the browser's find bar, in its parts: the field, the count, the two
// arrows, and a close. Enter and Shift+Enter in the field are the arrows, and
// Escape is the close, which are the keys the browser's own bar answers to.

/** The count, the way the browser's bar prints it. Empty until there is a query. */
function describeCount(search: DiffSearchState): string {
  const { current, matches, query, truncated } = search;
  const count = matches.length;
  if (count === 0) return query.length > 0 ? 'No matches' : '';
  const position = current === -1 ? '' : `${current + 1} of `;
  return `${position}${count}${truncated ? '+' : ''}`;
}

export function DiffSearchBar({ search }: { search: DiffSearchState }) {
  const { attachInput, matches, query } = search;
  const none = matches.length === 0;

  return (
    <div
      role="search"
      aria-label="Find in diff"
      className="border-line bg-surface flex h-9 shrink-0 items-center gap-1 border-b px-2"
    >
      <SearchField
        ref={attachInput}
        aria-label="Find in diff"
        placeholder="Find in diff…"
        value={query}
        wrapperClassName="max-phone:flex-1 w-72 max-w-full min-w-0"
        onChange={(event) => search.setQuery(event.target.value)}
        onKeyDown={(event) => {
          // An IME sends Enter to commit the composed text and Escape to drop
          // it, and both arrive here with `isComposing` set. Neither is the
          // bar's to answer, or a Chinese query steps the old search instead
          // of landing.
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) search.previous();
            else search.next();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            search.close();
          }
        }}
      />
      {/* Read out as it changes, so a screen reader hears the count land and
          the arrows move it without leaving the field. */}
      <p
        aria-live="polite"
        className={cn(
          'min-w-14 shrink-0 text-[11px] tabular-nums',
          none ? 'text-ink-faint' : 'text-ink-muted'
        )}
      >
        {describeCount(search)}
      </p>
      <Button
        aria-label="Previous match"
        disabled={none}
        size="icon-sm"
        title="Previous match (Shift+Enter)"
        variant="chrome"
        onClick={() => search.previous()}
      >
        <IconChevron className="rotate-180" size={14} />
      </Button>
      <Button
        aria-label="Next match"
        disabled={none}
        size="icon-sm"
        title="Next match (Enter)"
        variant="chrome"
        onClick={() => search.next()}
      >
        <IconChevron size={14} />
      </Button>
      <Button
        aria-label="Close the search"
        size="icon-sm"
        title="Close (Esc)"
        variant="chrome"
        onClick={() => search.close()}
      >
        <IconX size={13} />
      </Button>
    </div>
  );
}
