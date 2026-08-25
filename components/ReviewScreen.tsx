'use client';

import type {
  CodeViewDiffItem,
  CodeViewLineSelection,
  SelectedLineRange,
} from '@pierre/diffs';
import type { CodeViewHandle } from '@pierre/diffs/react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { ReviewHeader } from '@/components/ReviewHeader';
import { ReviewSidebar } from '@/components/ReviewSidebar';
import {
  isSameSelection,
  ReviewViewer,
  type ViewerControls,
} from '@/components/ReviewViewer';
import { useColorMode } from '@/hooks/useColorMode';
import { useGitHubToken } from '@/hooks/useGitHubToken';
import { useReviewComments } from '@/hooks/useReviewComments';
import { useReviewPatch } from '@/hooks/useReviewPatch';
import { useWatchedRepos } from '@/hooks/useWatchedRepos';
import type { CommentListEntry, CommentMetadata } from '@/lib/comments';
import { buildCommentSections } from '@/lib/commentSections';
import {
  applyReviewFilter,
  availableStatuses,
  EMPTY_FILTER_STATE,
  type ReviewFilterState,
} from '@/lib/reviewFilter';
import { describeReviewTarget, type ReviewTarget } from '@/lib/reviewTarget';

const DEFAULT_CONTROLS: ViewerControls = {
  diffStyle: 'split',
  diffIndicators: 'bars',
  overflow: 'scroll',
  lineNumbers: true,
  backgrounds: true,
};

export function ReviewScreen({ target }: { target: ReviewTarget }) {
  const colorMode = useColorMode();
  const token = useGitHubToken();
  const watched = useWatchedRepos();
  const [controls, setControls] = useState<ViewerControls>(DEFAULT_CONTROLS);
  const [filter, setFilter] = useState<ReviewFilterState>(EMPTY_FILTER_STATE);
  const [selectedLines, setSelectedLines] =
    useState<CodeViewLineSelection | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CodeViewHandle<CommentMetadata> | null>(null);

  const patch = useReviewPatch({ target, token: token.token });
  const comments = useReviewComments({
    target,
    entries: patch.data.entries,
    token: token.token,
    viewerLogin: token.viewer?.login,
    ready: patch.state === 'ready',
  });

  const filtered = useMemo(
    () => applyReviewFilter(patch.data, filter),
    [filter, patch.data]
  );

  // CodeView keys an update off id and version, so an annotation change must
  // bump the version of the item that carries it.
  const items = useMemo<readonly CodeViewDiffItem<CommentMetadata>[]>(() => {
    if (comments.annotationsByItemId.size === 0) return filtered.items;
    return filtered.items.map((item) => {
      const annotations = comments.annotationsByItemId.get(item.id);
      if (annotations == null) return item;
      return {
        ...item,
        annotations: [...annotations],
        version: comments.revision,
      };
    });
  }, [comments.annotationsByItemId, comments.revision, filtered.items]);

  const commentSections = useMemo(
    () =>
      buildCommentSections(
        patch.data.items,
        comments.annotationsByItemId,
        patch.data.entries
      ),
    [comments.annotationsByItemId, patch.data.entries, patch.data.items]
  );

  const statuses = useMemo(
    () => availableStatuses(patch.data.entries),
    [patch.data.entries]
  );

  const handleSelectItem = useCallback((itemId: string) => {
    const viewer = viewerRef.current;
    if (viewer == null) return;
    const item = viewer.getItem(itemId);
    if (item?.collapsed === true) {
      viewer.updateItem({
        ...item,
        collapsed: false,
        version: (item.version ?? 0) + 1,
      });
    }
    viewer.scrollTo({
      type: 'item',
      id: itemId,
      align: 'start',
      behavior: 'smooth',
    });
  }, []);

  const handleSelectComment = useCallback((comment: CommentListEntry) => {
    const viewer = viewerRef.current;
    if (viewer == null) return;
    viewer.setSelectedLines({ id: comment.itemId, range: comment.range });
    viewer.scrollTo({
      type: 'line',
      id: comment.itemId,
      lineNumber: comment.range.end,
      side: comment.range.endSide ?? comment.range.side ?? comment.side,
      align: 'center',
      behavior: 'smooth-auto',
    });
  }, []);

  const handleCreateDraft = useCallback(
    (itemId: string, range: SelectedLineRange) => {
      comments.startDraft(itemId, range);
    },
    [comments]
  );

  const handleSelectedLinesChange = useCallback(
    (next: CodeViewLineSelection | null) => {
      setSelectedLines((current) =>
        isSameSelection(current, next) ? current : next
      );
    },
    []
  );

  return (
    <>
      <ReviewHeader
        colorMode={colorMode}
        controls={controls}
        onControlsChange={setControls}
        switcherLabel={describeReviewTarget(target)}
        token={token}
        watched={watched}
      />

      {patch.state === 'ready' ? (
        <div className="grid min-h-0 flex-1 grid-cols-[19rem_minmax(0,1fr)] overflow-hidden">
          <ReviewSidebar
            availableStatuses={statuses}
            colorScheme={colorMode.scheme}
            commentSections={commentSections}
            commentStore={comments.store}
            entries={patch.data.entries}
            filter={filter}
            hiddenCount={filtered.hiddenCount}
            onFilterChange={setFilter}
            onSelectComment={handleSelectComment}
            onSelectItem={handleSelectItem}
            stats={patch.data.stats}
            treeSource={filtered.treeSource}
            visibleFileCount={filtered.entries.length}
          />
          <ReviewViewer
            controls={controls}
            items={items}
            onCancelDraft={comments.removeComment}
            onCreateDraft={handleCreateDraft}
            onDeleteComment={comments.removeComment}
            onSaveDraft={comments.saveDraft}
            onSelectedLinesChange={handleSelectedLinesChange}
            scrollRef={scrollRef}
            selectedLines={selectedLines}
            themeType={colorMode.hydrated ? colorMode.mode : 'system'}
            viewerRef={viewerRef}
          />
        </div>
      ) : (
        <StatusPanel
          error={patch.error}
          onRetry={patch.retry}
          state={patch.state}
          target={target}
        />
      )}

      {comments.error != null && (
        <p
          role="status"
          className="border-line text-removed shrink-0 border-t px-3 py-1.5 text-xs"
        >
          {comments.error}
        </p>
      )}
    </>
  );
}

function StatusPanel({
  error,
  onRetry,
  state,
  target,
}: {
  error?: string;
  onRetry(): void;
  state: 'fetching' | 'parsing' | 'error';
  target: ReviewTarget;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <div className="max-w-md text-center">
        <p className="text-ink-faint font-mono text-xs">
          {describeReviewTarget(target)}
        </p>
        {state === 'error' ? (
          <>
            <p className="text-removed mt-2 text-sm">
              {error ?? 'Could not load that diff.'}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="text-accent mt-3 cursor-pointer text-sm underline"
            >
              Try again
            </button>
          </>
        ) : (
          <p className="text-ink-muted mt-2 text-sm">
            {state === 'fetching' ? 'Loading the diff…' : 'Parsing the diff…'}
          </p>
        )}
      </div>
    </div>
  );
}
