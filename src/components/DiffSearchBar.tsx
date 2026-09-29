import { IconChevron, IconX } from '@pierre/icons';

import { Button } from '@/components/ui/Button';
import { SearchField } from '@/components/ui/SearchField';
import type { DiffSearchState } from '@/hooks/useDiffSearch';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/locale';
import { m } from '@/paraglide/messages.js';

// Find in diff, as a strip above the diff.
//
// A strip and not a floating panel, for the reason the sidebar's path search
// is a strip under its own controls: a panel over the top-right of the diff
// would sit on the sticky header's Viewed toggle for as long as it was open.
// The strip takes its row from the diff instead, and the viewer measures
// itself again the way it does for any resize.
//
// It is the browser's find bar, in its parts: the field, the count, the two
// arrows, and a close. Enter and Shift+Enter anywhere in the bar are the arrows, and
// Escape is the close, which are the keys the browser's own bar answers to.

/** The count, the way the browser's bar prints it. Empty until there is a query. */
function describeCount(search: DiffSearchState): string {
  const { current, matches, query, truncated } = search;
  const count = matches.length;
  if (count === 0)
    return query.length > 0 ? m.diff_search_bar_no_matches() : '';
  const total = truncated
    ? m.diff_search_more({ count: formatNumber(count) })
    : formatNumber(count);
  return current === -1
    ? total
    : m.diff_search_position({
        position: formatNumber(current + 1),
        count: total,
      });
}

export function DiffSearchBar({ search }: { search: DiffSearchState }) {
  const { attachInput, matches, query } = search;
  const none = matches.length === 0;

  return (
    <div
      role="search"
      aria-label={m.diff_search_bar_find_in_diff()}
      // Capture before a focused button can turn Enter into a click.
      onKeyDownCapture={(event) => {
        // An IME sends Enter to commit the composed text and Escape to drop
        // it, and both arrive here with `isComposing` set. Neither is the
        // bar's to answer, or a Chinese query steps the old search instead
        // of landing.
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          if (event.shiftKey) search.previous();
          else search.next();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          search.close();
        }
      }}
      className="border-line bg-surface flex h-9 shrink-0 items-center gap-1 border-b px-2"
    >
      <SearchField
        ref={attachInput}
        aria-label={m.diff_search_bar_find_in_diff()}
        placeholder={m.diff_search_bar_find_in_diff_text()}
        value={query}
        wrapperClassName="max-phone:flex-1 w-72 max-w-full min-w-0"
        onChange={(event) => search.setQuery(event.target.value)}
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
        aria-label={m.diff_search_bar_previous_match()}
        disabled={none}
        size="icon-sm"
        title={m.diff_search_bar_previous_match_shiftenter()}
        variant="chrome"
        onClick={() => search.previous()}
      >
        <IconChevron className="rotate-180" size={14} />
      </Button>
      <Button
        aria-label={m.diff_search_bar_next_match()}
        disabled={none}
        size="icon-sm"
        title={m.diff_search_bar_next_match_enter()}
        variant="chrome"
        onClick={() => search.next()}
      >
        <IconChevron size={14} />
      </Button>
      <Button
        aria-label={m.diff_search_bar_close_the_search()}
        size="icon-sm"
        title={m.diff_search_bar_close_esc()}
        variant="chrome"
        onClick={() => search.close()}
      >
        <IconX size={13} />
      </Button>
    </div>
  );
}
