'use client';

import { IconComment, IconFileTree, IconSearch, IconX } from '@pierre/icons';
import type { GitStatus } from '@pierre/trees';
import { useEffect, useRef, useState } from 'react';

import { CommentsList } from '@/components/CommentsList';
import { FilterMenu } from '@/components/FilterMenu';
import { ReviewFileTree } from '@/components/ReviewFileTree';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Segmented,
  SegmentedCount,
  SegmentedItem,
} from '@/components/ui/Segmented';
import type { ColorScheme } from '@/hooks/useColorMode';
import type { CommentStore } from '@/hooks/useReviewComments';
import type { CommentListEntry, CommentListSection } from '@/lib/comments';
import { countComments, countThreads } from '@/lib/commentSections';
import type { ReviewFileEntry, ReviewDiffStats } from '@/lib/reviewData';
import {
  EMPTY_FILTER_STATE,
  type ReviewFilterState,
  type ReviewTreeSource,
} from '@/lib/reviewFilter';

type Tab = 'files' | 'comments';

interface ReviewSidebarProps {
  /** The file the diff is scrolled to, which the tree follows. */
  activeItemId?: string;
  /** The thread the diff has selected, which the comment list follows. */
  activeThreadKey?: string;
  availableStatuses: ReadonlySet<GitStatus>;
  colorScheme: ColorScheme;
  commentSections: readonly CommentListSection[];
  commentStore: CommentStore;
  entries: readonly ReviewFileEntry[];
  filter: ReviewFilterState;
  hiddenCount: number;
  onFilterChange(next: ReviewFilterState): void;
  onSelectComment(comment: CommentListEntry): void;
  onSelectItem(itemId: string): void;
  stats: ReviewDiffStats;
  treeSource: ReviewTreeSource;
  visibleFileCount: number;
}

export function ReviewSidebar({
  activeItemId,
  activeThreadKey,
  availableStatuses,
  colorScheme,
  commentSections,
  commentStore,
  entries,
  filter,
  hiddenCount,
  onFilterChange,
  onSelectComment,
  onSelectItem,
  stats,
  treeSource,
  visibleFileCount,
}: ReviewSidebarProps) {
  const [tab, setTab] = useState<Tab>('files');
  // The field is shown on demand, and closing it clears the query. A path
  // filter that hides files from a closed field would hide them for good.
  const [searching, setSearching] = useState(false);
  const closeSearch = () => {
    setSearching(false);
    if (filter.query.length > 0) onFilterChange({ ...filter, query: '' });
  };

  const commentCount = countComments(commentSections);
  const threadCount = countThreads(commentSections);

  return (
    <aside className="border-line bg-surface flex h-full min-h-0 flex-col border-r">
      <div className="flex items-center gap-1 px-2 pt-2 pb-1">
        <Segmented
          aria-label="Sidebar sections"
          onValueChange={(value) => setTab(value as Tab)}
          value={tab}
        >
          <SegmentedItem value="files">
            <IconFileTree size={13} />
            Files
            <SegmentedCount>{visibleFileCount}</SegmentedCount>
          </SegmentedItem>
          <SegmentedItem
            value="comments"
            // Threads are what the list shows; the message total is the title.
            title={`${threadCount} threads, ${commentCount} comments`}
          >
            <IconComment size={13} />
            Comments
            <SegmentedCount>{threadCount}</SegmentedCount>
          </SegmentedItem>
        </Segmented>
        {tab === 'files' && (
          <Button
            aria-label={searching ? 'Hide the path search' : 'Search by path'}
            aria-pressed={searching}
            className="ml-auto"
            size="icon-sm"
            title="Search by path"
            variant="chrome"
            onClick={() => (searching ? closeSearch() : setSearching(true))}
          >
            <IconSearch size={14} />
          </Button>
        )}
      </div>

      {tab === 'files' && (
        // The search field and the rules button are one block, directly under
        // the control that opens the field. The tree's own search box sat
        // below this border, inside the scroll region, two rows from its
        // toggle, and it narrowed the tree while the diff kept every file.
        <div className="border-line space-y-1.5 border-b px-2 pb-2">
          {searching && (
            <PathSearchField
              value={filter.query}
              onChange={(query) => onFilterChange({ ...filter, query })}
              onClose={closeSearch}
            />
          )}
          <FilterMenu
            availableStatuses={availableStatuses}
            entries={entries}
            hiddenCount={hiddenCount}
            onChange={onFilterChange}
            state={filter}
          />
        </div>
      )}

      <div className="min-h-0 flex-1 pt-2">
        <div
          role="region"
          aria-label="Files"
          hidden={tab !== 'files'}
          className="h-full min-h-0"
        >
          {treeSource.paths.length === 0 ? (
            <div className="px-3 py-3">
              <p className="text-ink-muted text-sm">
                Every file is hidden by the current filter.
              </p>
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                onClick={() => onFilterChange(EMPTY_FILTER_STATE)}
              >
                Clear every filter
              </Button>
            </div>
          ) : (
            <ReviewFileTree
              activeItemId={activeItemId}
              colorScheme={colorScheme}
              onSelectPath={onSelectItem}
              source={treeSource}
            />
          )}
        </div>
        <div
          role="region"
          aria-label="Comments"
          hidden={tab !== 'comments'}
          className="h-full min-h-0"
        >
          <CommentsList
            activeKey={activeThreadKey}
            onSelectThread={onSelectComment}
            sections={commentSections}
            store={commentStore}
          />
        </div>
      </div>

      <dl className="border-line text-ink-muted flex items-center gap-3 border-t px-3 py-2 text-xs tabular-nums">
        <div className="flex gap-1">
          <dt className="sr-only">Files</dt>
          <dd>{stats.fileCount} files</dd>
        </div>
        <div className="flex gap-1">
          <dt className="sr-only">Added lines</dt>
          <dd className="text-added">+{stats.addedLines}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="sr-only">Deleted lines</dt>
          <dd className="text-removed">-{stats.deletedLines}</dd>
        </div>
      </dl>
    </aside>
  );
}

/**
 * The path query, which is one of the three tests in `applyReviewFilter`. So it
 * takes a file out of the tree and out of the diff together, the way a preset
 * does, instead of only marking rows in the tree.
 */
function PathSearchField({
  onChange,
  onClose,
  value,
}: {
  onChange(query: string): void;
  onClose(): void;
  value: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // A press on the magnifier opens this field, and a field is opened to be
  // typed in.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="relative">
      <IconSearch
        className="text-ink-faint pointer-events-none absolute top-1/2 left-2 -translate-y-1/2"
        size={12}
      />
      <Input
        ref={inputRef}
        aria-label="Search files by path"
        autoComplete="off"
        className="h-7 pr-7 pl-7 text-xs"
        placeholder="Path contains…"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      />
      {value.length > 0 && (
        <button
          aria-label="Clear the path search"
          className="text-ink-faint hover:text-ink absolute top-1/2 right-1.5 flex size-4 -translate-y-1/2 cursor-pointer items-center justify-center"
          type="button"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
        >
          <IconX size={12} />
        </button>
      )}
    </div>
  );
}
