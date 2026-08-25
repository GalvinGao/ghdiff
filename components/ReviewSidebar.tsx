'use client';

import type { FileTree as FileTreeModel } from '@pierre/trees';
import type { GitStatus } from '@pierre/trees';
import { useFileTreeSearch } from '@pierre/trees/react';
import { useCallback, useState } from 'react';

import { CommentsList } from '@/components/CommentsList';
import { FilterMenu } from '@/components/FilterMenu';
import { ReviewFileTree } from '@/components/ReviewFileTree';
import { Button } from '@/components/ui/Button';
import type { ColorScheme } from '@/hooks/useColorMode';
import type { CommentStore } from '@/hooks/useReviewComments';
import { cn } from '@/lib/cn';
import type { CommentListEntry, CommentListSection } from '@/lib/comments';
import type { ReviewFileEntry, ReviewDiffStats } from '@/lib/reviewData';
import type { ReviewFilterState, ReviewTreeSource } from '@/lib/reviewFilter';

type Tab = 'files' | 'comments';

interface ReviewSidebarProps {
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

  let commentCount = 0;
  for (const section of commentSections) {
    commentCount += section.comments.length;
  }

  return (
    <aside className="border-line bg-surface flex h-full min-h-0 flex-col border-r">
      <div className="flex items-center gap-1 px-2 pt-2 pb-1">
        <TabButton
          active={tab === 'files'}
          count={visibleFileCount}
          label="Files"
          onClick={() => setTab('files')}
        />
        <TabButton
          active={tab === 'comments'}
          count={commentCount}
          label="Comments"
          onClick={() => setTab('comments')}
        />
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
          className="h-full min-h-0 pl-1"
        >
          {treeSource.paths.length === 0 ? (
            <p className="text-ink-muted px-2 py-3 text-sm">
              Every file is hidden by the current filter.
            </p>
          ) : (
            <ReviewFileTree
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
            onSelectComment={onSelectComment}
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

function TabButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick(): void;
}) {
  return (
    <Button
      size="sm"
      variant={active ? 'outline' : 'ghost'}
      aria-pressed={active}
      onClick={onClick}
      className={cn(active && 'bg-raised text-ink')}
    >
      {label}
      <span className="text-ink-faint tabular-nums">{count}</span>
    </Button>
  );
}

function TreeSearchToggle({ model }: { model: FileTreeModel }) {
  const search = useFileTreeSearch(model);
  return (
    <Button
      size="sm"
      variant="ghost"
      className="ml-auto"
      aria-pressed={search.isOpen}
      // The tree's search input closes on blur, so focus must not move here
      // before the click handler runs.
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => (search.isOpen ? search.close() : search.open())}
    >
      Search
    </Button>
  );
}
