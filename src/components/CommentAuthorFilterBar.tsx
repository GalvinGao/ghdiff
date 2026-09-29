import { HubotIcon } from '@primer/octicons-react/HubotIcon';
import { PersonIcon } from '@primer/octicons-react/PersonIcon';

import { m } from '../paraglide/messages.js';
import {
  Segmented,
  SegmentedCount,
  SegmentedItem,
} from '@/components/ui/Segmented';
import type {
  CommentAuthorCounts,
  CommentAuthorFilter,
} from '@/lib/commentAuthors';

// Who wrote the threads the list shows.
//
// A review bot writes most of the comments on a busy repository, so reading
// what a colleague said means reading past all of them. This is the switch that
// puts one kind of author on screen at a time, and it stands at the foot of the
// panel because it is set once and then left alone: it must not take space from
// the list above it every time the eye passes over the panel.

interface CommentAuthorFilterBarProps {
  counts: CommentAuthorCounts;
  onChange(next: CommentAuthorFilter): void;
  value: CommentAuthorFilter;
}

export function CommentAuthorFilterBar({
  counts,
  onChange,
  value,
}: CommentAuthorFilterBarProps) {
  const total = counts.people + counts.bots;
  return (
    <Segmented
      aria-label={m.comment_author_filter_bar_comment_authors()}
      className="w-full"
      onValueChange={(next) => onChange(next as CommentAuthorFilter)}
      value={value}
    >
      <SegmentedItem className="h-6 px-1.5" value="all">
        {m.comment_author_filter_bar_all()}
        <SegmentedCount>{total}</SegmentedCount>
      </SegmentedItem>
      <SegmentedItem
        className="h-6 px-1.5"
        title={m.comment_author_filter_bar_comments_a_person_opened()}
        value="people"
      >
        <PersonIcon size={12} />
        {m.comment_author_filter_bar_people()}
        <SegmentedCount>{counts.people}</SegmentedCount>
      </SegmentedItem>
      <SegmentedItem
        className="h-6 px-1.5"
        title={m.comment_author_filter_bar_comments_a_github_app_opened()}
        value="bots"
      >
        <HubotIcon size={12} />
        {m.comment_author_filter_bar_bots()}
        <SegmentedCount>{counts.bots}</SegmentedCount>
      </SegmentedItem>
    </Segmented>
  );
}
