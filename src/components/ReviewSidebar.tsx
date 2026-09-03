import { IconComment, IconFileTree, IconSearch, IconX } from '@pierre/icons';
import type { GitStatus } from '@pierre/trees';
import { useEffect, useRef, useState } from 'react';

import { CommentAuthorFilterBar } from '@/components/CommentAuthorFilterBar';
import { CommentsList } from '@/components/CommentsList';
import { FilterMenu } from '@/components/FilterMenu';
import { ReviewFileTree, treeStatLaneInset } from '@/components/ReviewFileTree';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Segmented,
  SegmentedCount,
  SegmentedItem,
} from '@/components/ui/Segmented';
import type { ColorScheme } from '@/hooks/useColorMode';
import type { CommentStore } from '@/hooks/useReviewComments';
import { cn } from '@/lib/cn';
import type {
  CommentAuthorCounts,
  CommentAuthorFilter,
} from '@/lib/commentAuthors';
import type { CommentListEntry, CommentListSection } from '@/lib/comments';
import { countComments, countThreads } from '@/lib/commentSections';
import type { RawThread } from '@/lib/commentThreads';
import type { ReviewFileEntry, ReviewDiffStats } from '@/lib/reviewData';
import {
  EMPTY_FILTER_STATE,
  type ReviewFilterState,
  type ReviewTreeSource,
} from '@/lib/reviewFilter';
import type { TreeStatIndex } from '@/lib/treeStats';

type Tab = 'files' | 'comments';

interface ReviewSidebarProps {
  unplacedThreads: readonly RawThread[];
  /** The file the diff is scrolled to, which the tree follows. */
  activeItemId?: string;
  /** Where the caller puts this: a column beside the diff, or over it. */
  className?: string;
  /** The thread the diff has selected, which the comment list follows. */
  activeThreadKey?: string;
  authorCounts: CommentAuthorCounts;
  authorFilter: CommentAuthorFilter;
  availableStatuses: ReadonlySet<GitStatus>;
  colorScheme: ColorScheme;
  /** Already narrowed by `authorFilter`. This is what the list shows. */
  commentSections: readonly CommentListSection[];
  commentStore: CommentStore;
  entries: readonly ReviewFileEntry[];
  filter: ReviewFilterState;
  hiddenCount: number;
  onAuthorFilterChange(next: CommentAuthorFilter): void;
  onFilterChange(next: ReviewFilterState): void;
  onSelectComment(comment: CommentListEntry): void;
  onSelectItem(itemId: string): void;
  /** The files on screen, not the whole patch. */
  stats: ReviewDiffStats;
  /** Total files in the patch, so the footer can say what is hidden. */
  totalFileCount: number;
  treeSource: ReviewTreeSource;
  treeStats: TreeStatIndex;
}

export function ReviewSidebar({
  unplacedThreads,
  activeItemId,
  activeThreadKey,
  className,
  authorCounts,
  authorFilter,
  availableStatuses,
  colorScheme,
  commentSections,
  commentStore,
  entries,
  filter,
  hiddenCount,
  onAuthorFilterChange,
  onFilterChange,
  onSelectComment,
  onSelectItem,
  stats,
  totalFileCount,
  treeSource,
  treeStats,
}: ReviewSidebarProps) {
  const [tab, setTab] = useState<Tab>('files');
  // The field is shown on demand, and closing it clears the query. A path
  // filter that hides files from a closed field would hide them for good.
  const [searching, setSearching] = useState(filter.query.length > 0);
  const closeSearch = () => {
    setSearching(false);
    if (filter.query.length > 0) onFilterChange({ ...filter, query: '' });
  };

  const commentCount =
    countComments(commentSections) +
    unplacedThreads.reduce((sum, thread) => sum + thread.comments.length, 0);
  const threadCount = countThreads(commentSections) + unplacedThreads.length;

  return (
    <aside
      className={cn(
        'border-line bg-surface flex h-full min-h-0 flex-col border-r',
        className
      )}
    >
      <div className="flex items-center gap-1 px-2 pt-2 pb-1">
        <Segmented
          aria-label="Sidebar sections"
          onValueChange={(value) => setTab(value as Tab)}
          value={tab}
        >
          <SegmentedItem value="files">
            <IconFileTree size={13} />
            Files
            <SegmentedCount>{stats.fileCount}</SegmentedCount>
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
                {totalFileCount === 0
                  ? 'No file changes in this diff.'
                  : 'The current filter hides all files.'}
              </p>
              {totalFileCount > 0 && (
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  onClick={() => onFilterChange(EMPTY_FILTER_STATE)}
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <ReviewFileTree
              activeItemId={activeItemId}
              colorScheme={colorScheme}
              onSelectPath={onSelectItem}
              source={treeSource}
              stats={treeStats}
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
            unplacedThreads={unplacedThreads}
            activeKey={activeThreadKey}
            onSelectFile={onSelectItem}
            onSelectThread={onSelectComment}
            sections={commentSections}
            store={commentStore}
          />
        </div>
      </div>

      {/* One strip, and it belongs to whichever tab is open: the files tab has
          a size to report and the comments tab has a filter to set, and neither
          has anything to say about the other. The right edge is each tab's own:
          the filter bar runs to the padding, and the totals stop where the
          tree's figures stop. */}
      <div className="border-line flex h-9 shrink-0 items-center border-t pl-2">
        {tab === 'files' ? (
          <FileTotals
            gitLaneActive={treeSource.gitStatus.length > 0}
            hiddenCount={hiddenCount}
            stats={stats}
            totalFileCount={totalFileCount}
            treeStats={treeStats}
          />
        ) : (
          <div className="flex min-w-0 flex-1 pr-2">
            <CommentAuthorFilterBar
              counts={authorCounts}
              onChange={onAuthorFilterChange}
              value={authorFilter}
            />
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * The size of the review on screen. The count is the count of the files the
 * tree lists above it, and it says so when a filter is holding some back: a
 * footer that reported the whole patch while the tree showed a third of it made
 * the two panes disagree.
 *
 * The two figures are the last row of the tree's own two columns, so they keep
 * the tree's trailing inset and the tree's gap rather than running out to the
 * edge of the strip. Nothing else in the sidebar prints a number against a
 * column of numbers, and a total that missed the column it totals read as a
 * third figure rather than the sum of the two above it.
 */
function FileTotals({
  gitLaneActive,
  hiddenCount,
  stats,
  totalFileCount,
  treeStats,
}: {
  /** Whether the tree drew the git badge's lane, which the figures clear. */
  gitLaneActive: boolean;
  hiddenCount: number;
  stats: ReviewDiffStats;
  totalFileCount: number;
  treeStats: TreeStatIndex;
}) {
  // A minimum, not a width. The tree's columns are sized for the widest row,
  // and a patch with two top-level directories has a total wider than either of
  // them, which a fixed width would spill out of. Growing keeps the deleted
  // figure against the same right edge and moves the added one left, which is
  // the truth: that total needs the room.
  const addColumn = { minWidth: `${String(treeStats.addedDigits + 1)}ch` };
  const deleteColumn = { minWidth: `${String(treeStats.deletedDigits + 1)}ch` };
  return (
    <dl
      className="text-ink-muted flex w-full min-w-0 items-baseline gap-2 pl-1 text-[11px] tabular-nums"
      style={{ paddingRight: treeStatLaneInset(gitLaneActive) }}
    >
      <div className="flex min-w-0 gap-1 truncate">
        <dt className="sr-only">Files</dt>
        <dd>
          {stats.fileCount} {stats.fileCount === 1 ? 'file' : 'files'}
          {hiddenCount > 0 && (
            <span className="text-ink-faint"> of {totalFileCount}</span>
          )}
        </dd>
      </div>
      {/* The tree's own two columns, in the same order, the same two colours,
          the same widths and the same 5px gap it puts between them on every row
          above. The widths are the tree's, not these two numbers': a total
          sized to its own digits would sit a pixel or two off the column it
          totals. */}
      <div className="ml-auto flex shrink-0 gap-[5px]">
        <div className="flex">
          <dt className="sr-only">Added lines</dt>
          <dd className="text-added text-right" style={addColumn}>
            +{stats.addedLines}
          </dd>
        </div>
        <div className="flex">
          <dt className="sr-only">Deleted lines</dt>
          <dd className="text-removed text-right" style={deleteColumn}>
            -{stats.deletedLines}
          </dd>
        </div>
      </div>
    </dl>
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
