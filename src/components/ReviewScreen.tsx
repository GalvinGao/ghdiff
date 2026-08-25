import {
  areSelectionsEqual,
  type CodeViewDiffItem,
  type CodeViewLineSelection,
  type SelectedLineRange,
} from '@pierre/diffs';
import type { CodeViewHandle } from '@pierre/diffs/react';
import { IconCiWarningFill, IconXSquircle } from '@pierre/icons';
import { useCallback, useMemo, useRef, useState } from 'react';

import { ReviewHeader } from '@/components/ReviewHeader';
import { ReviewSidebar } from '@/components/ReviewSidebar';
import { ReviewStatusPanel } from '@/components/ReviewStatusPanel';
import {
  isSameSelection,
  ReviewViewer,
  type ViewerControls,
} from '@/components/ReviewViewer';
import { Button } from '@/components/ui/Button';
import { useActiveDiffItem } from '@/hooks/useActiveDiffItem';
import { useColorMode } from '@/hooks/useColorMode';
import { useGitHubToken } from '@/hooks/useGitHubToken';
import { usePullDetails } from '@/hooks/usePullDetails';
import { useReviewComments } from '@/hooks/useReviewComments';
import { useReviewPatch } from '@/hooks/useReviewPatch';
import { useWatchedRepos } from '@/hooks/useWatchedRepos';
import { useWorkerPoolReady } from '@/hooks/useWorkerPoolReady';
import { cn } from '@/lib/cn';
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
  const workersReady = useWorkerPoolReady();
  const token = useGitHubToken();
  const watched = useWatchedRepos();
  const [controls, setControls] = useState<ViewerControls>(DEFAULT_CONTROLS);
  const [filter, setFilter] = useState<ReviewFilterState>(EMPTY_FILTER_STATE);
  const [selectedLines, setSelectedLines] =
    useState<CodeViewLineSelection | null>(null);
  // The comment failure the reviewer has already read and waved away.
  const [dismissedError, setDismissedError] = useState<string | undefined>(
    undefined
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CodeViewHandle<CommentMetadata> | null>(null);

  const patch = useReviewPatch({
    target,
    token: token.token,
    tokenReady: token.hydrated,
  });
  // Depends on the three parts, not on the target: a server component hands the
  // target down, so its identity changes on every read of the RSC payload.
  const pullTarget = target.kind === 'github-pull' ? target : undefined;
  const pull = usePullDetails({
    number: pullTarget?.number,
    owner: pullTarget?.owner,
    repo: pullTarget?.repo,
    token: token.token,
  });
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

  const itemIds = useMemo(() => items.map((item) => item.id), [items]);
  const active = useActiveDiffItem(itemIds);

  // The selected lines are the truth about which thread the reviewer is on, so
  // the row in the sidebar lights up whether they clicked it there or landed on
  // the same lines in the diff.
  const activeThreadKey = useMemo(() => {
    if (selectedLines == null) return undefined;
    for (const section of commentSections) {
      if (section.itemId !== selectedLines.id) continue;
      for (const thread of section.threads) {
        if (areSelectionsEqual(thread.range, selectedLines.range)) {
          return thread.key;
        }
      }
    }
    return undefined;
  }, [commentSections, selectedLines]);

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
        currentPull={pullTarget}
        onControlsChange={setControls}
        pull={pullTarget == null ? undefined : pull}
        switcherLabel={describeReviewTarget(target)}
        token={token}
        watched={watched}
      />

      {patch.state === 'ready' && workersReady ? (
        <div className="bg-canvas grid min-h-0 flex-1 grid-cols-[19rem_minmax(0,1fr)] overflow-hidden">
          <ReviewSidebar
            activeItemId={active.activeItemId}
            activeThreadKey={activeThreadKey}
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
            onScroll={active.onScroll}
            onSelectedLinesChange={handleSelectedLinesChange}
            scrollRef={scrollRef}
            selectedLines={selectedLines}
            themeType={colorMode.hydrated ? colorMode.mode : 'system'}
            viewerRef={viewerRef}
          />
        </div>
      ) : (
        <ReviewStatusPanel
          error={patch.error}
          onRetry={patch.retry}
          state={patch.state === 'ready' ? 'starting' : patch.state}
          target={target}
        />
      )}

      {patch.notice != null && (
        <ReviewNotice tone="muted">{patch.notice}</ReviewNotice>
      )}
      {comments.error != null && comments.error !== dismissedError && (
        <ReviewNotice
          onDismiss={() => setDismissedError(comments.error)}
          tone="error"
        >
          {comments.error}
        </ReviewNotice>
      )}
    </>
  );
}

/**
 * A line along the bottom of the surface. A failure to post a comment must be
 * said out loud, and must then be dismissable: the diff is still usable, and
 * the strip would otherwise sit there for the rest of the review.
 */
function ReviewNotice({
  children,
  onDismiss,
  tone,
}: {
  children: string;
  onDismiss?(): void;
  tone: 'muted' | 'error';
}) {
  return (
    <div
      role="status"
      className="border-line flex shrink-0 items-center gap-2 border-t px-3 py-1.5"
    >
      {tone === 'error' && (
        <IconCiWarningFill
          aria-hidden="true"
          className="text-removed shrink-0"
          size={13}
        />
      )}
      <p
        className={cn(
          'min-w-0 flex-1 truncate text-xs',
          tone === 'error' ? 'text-removed' : 'text-ink-muted'
        )}
        title={children}
      >
        {children}
      </p>
      {onDismiss != null && (
        <Button
          aria-label="Dismiss"
          size="icon-sm"
          title="Dismiss"
          variant="quiet"
          onClick={onDismiss}
        >
          <IconXSquircle size={13} />
        </Button>
      )}
    </div>
  );
}
