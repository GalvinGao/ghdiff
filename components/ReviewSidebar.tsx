'use client';

import { IconComment, IconFileTree, IconSearch } from '@pierre/icons';
import type { FileTree as FileTreeModel } from '@pierre/trees';
import type { GitStatus } from '@pierre/trees';
import { useFileTreeSearch } from '@pierre/trees/react';
import { useCallback, useState } from 'react';

import { CommentsList } from '@/components/CommentsList';
import { FilterMenu } from '@/components/FilterMenu';
import { ReviewFileTree } from '@/components/ReviewFileTree';
import { Button } from '@/components/ui/Button';
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
  const [model, setModel] = useState<FileTreeModel | null>(null);
  const handleModelReady = useCallback(
    (next: FileTreeModel | null) => setModel(next),
    []
  );

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
        {tab === 'files' && model != null && <TreeSearchToggle model={model} />}
      </div>

      {tab === 'files' && (
        <div className="border-line border-b px-2 pb-2">
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
              onModelReady={handleModelReady}
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

function TreeSearchToggle({ model }: { model: FileTreeModel }) {
  const search = useFileTreeSearch(model);
  return (
    <Button
      aria-label={search.isOpen ? 'Hide file search' : 'Search files'}
      aria-pressed={search.isOpen}
      className="ml-auto"
      size="icon-sm"
      title="Search files"
      variant="chrome"
      // The tree's search input closes on blur, so focus must not move here
      // before the click handler runs.
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => (search.isOpen ? search.close() : search.open())}
    >
      <IconSearch size={14} />
    </Button>
  );
}
