import {
  areSelectionsEqual,
  type CodeViewDiffItem,
  type CodeViewLineSelection,
  type SelectedLineRange,
} from '@pierre/diffs';
import type { CodeViewHandle } from '@pierre/diffs/react';
import { IconCiWarningFill, IconXSquircle } from '@pierre/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAppData } from '@/components/AppDataProvider';
import { PaneResizeHandle } from '@/components/PaneResizeHandle';
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
import { type DiffAnchorTarget, useDiffAnchor } from '@/hooks/useDiffAnchor';
import { useStoredJson } from '@/hooks/useLocalStorage';
import { usePullDetails } from '@/hooks/usePullDetails';
import { useReviewComments } from '@/hooks/useReviewComments';
import { useReviewPatch } from '@/hooks/useReviewPatch';
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_PROPERTY,
  useSidebarWidth,
} from '@/hooks/useSidebarWidth';
import { useSubmitReview } from '@/hooks/useSubmitReview';
import { useWorkerPoolReady } from '@/hooks/useWorkerPoolReady';
import { cn } from '@/lib/cn';
import {
  type CommentAuthorFilter,
  countCommentAuthors,
  DEFAULT_COMMENT_AUTHOR_FILTER,
  filterCommentSections,
  isCommentAuthorFilter,
} from '@/lib/commentAuthors';
import type { CommentListEntry, CommentMetadata } from '@/lib/comments';
import { buildCommentSections } from '@/lib/commentSections';
import { reviewTargetUrl } from '@/lib/githubUrls';
import {
  applyReviewFilter,
  availableStatuses,
  EMPTY_FILTER_STATE,
  type ReviewFilterState,
} from '@/lib/reviewFilter';
import { describeReviewTarget, type ReviewTarget } from '@/lib/reviewTarget';
import { COMMENT_AUTHOR_FILTER_STORAGE_KEY } from '@/lib/storageKeys';
import { buildTreeStatIndex } from '@/lib/treeStats';

// Frames a range anchor is given to resolve. The scroll to the file is what
// renders it, and the range can only be measured once it has been. Four frames
// is long enough for that and short enough that a reviewer who starts scrolling
// straight away is not fought for it.
const ANCHOR_RANGE_ATTEMPTS = 4;

const DEFAULT_CONTROLS: ViewerControls = {
  diffStyle: 'split',
  diffIndicators: 'bars',
  overflow: 'scroll',
  lineNumbers: true,
  backgrounds: true,
};

export function ReviewScreen({ target }: { target: ReviewTarget }) {
  // The left bar owns these, so the diff and the bar cannot disagree about who
  // the token belongs to or which repositories are watched.
  const { colorMode, pulls: openPulls, token, watched } = useAppData();
  const workersReady = useWorkerPoolReady();
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
  // The frame waiting to try a range anchor again. See handleApplyAnchor.
  const anchorFramesRef = useRef<number | null>(null);
  // Destructured, so nothing reads a property of the state object while this
  // component renders.
  const {
    attach: attachLayout,
    onHandleKeyDown: onSidebarHandleKeyDown,
    onHandlePointerDown: onSidebarHandlePointerDown,
    reset: resetSidebarWidth,
    style: sidebarStyle,
    width: sidebarWidth,
  } = useSidebarWidth();
  const authorFilter = useStoredJson<CommentAuthorFilter>(
    COMMENT_AUTHOR_FILTER_STORAGE_KEY,
    DEFAULT_COMMENT_AUTHOR_FILTER
  );
  // Storage holds whatever an older build wrote there, so the value is checked
  // rather than trusted.
  const authorMode = isCommentAuthorFilter(authorFilter.value)
    ? authorFilter.value
    : DEFAULT_COMMENT_AUTHOR_FILTER;

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
  const review = useSubmitReview({
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

  // Every thread in the diff, and the subset the sidebar lists. The counts come
  // from the whole set, so the buttons still say how many the other filter
  // holds while one of them is on.
  const authorCounts = useMemo(
    () => countCommentAuthors(commentSections),
    [commentSections]
  );
  const listedSections = useMemo(
    () => filterCommentSections(commentSections, authorMode),
    [authorMode, commentSections]
  );

  // Read from the filtered list, not from the whole patch. The filter drives
  // both panes, so a directory total has to be the sum of the rows listed under
  // it: a folder reporting lines from a file the filter hid would contradict
  // its own children.
  const treeStats = useMemo(
    () => buildTreeStatIndex(filtered.entries),
    [filtered.entries]
  );

  const statuses = useMemo(
    () => availableStatuses(patch.data.entries),
    [patch.data.entries]
  );

  const itemIds = useMemo(() => items.map((item) => item.id), [items]);
  // Destructured: every jump handler below states the file it lands on, and a
  // handler that changed identity on each render would re-render the tree and
  // the viewer with it. The scroll region goes in because a jump holds the mark
  // until it lands, and a gesture in that region is what cuts the hold short.
  const {
    activeItemId,
    onScroll: onDiffScroll,
    select: selectActiveItem,
  } = useActiveDiffItem(itemIds, scrollRef);

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

  useEffect(
    () => () => {
      if (anchorFramesRef.current != null) {
        cancelAnimationFrame(anchorFramesRef.current);
      }
    },
    []
  );

  // Puts the reviewer where the URL fragment says. A fragment that names lines
  // highlights them; one that names only a file takes the highlight away, so
  // the address and the diff never disagree about what is marked.
  const handleApplyAnchor = useCallback(
    (anchored: DiffAnchorTarget | null) => {
      const viewer = viewerRef.current;
      if (anchorFramesRef.current != null) {
        cancelAnimationFrame(anchorFramesRef.current);
        anchorFramesRef.current = null;
      }
      if (viewer == null) return;
      if (anchored == null) {
        clearViewerSelection(viewer, setSelectedLines);
        return;
      }
      expandItem(viewer, anchored.itemId);
      const { itemId, range } = anchored;
      selectActiveItem(itemId);
      if (range == null) {
        clearViewerSelection(viewer, setSelectedLines);
      } else {
        // The viewer reports this back through onSelectedLinesChange, which is
        // what puts it into this component's state.
        viewer.setSelectedLines({ id: itemId, range });
      }

      // The file first, always. Its top is in the viewer's own layout, so this
      // one lands whatever is on screen.
      viewer.scrollTo({
        type: 'item',
        id: itemId,
        align: 'start',
        behavior: 'instant',
      });
      if (range == null) return;

      // Then the lines. A range resolves through `getLinePosition`, which answers
      // only for a file the viewer has already rendered, and the file a fragment
      // names is almost always far off screen when the fragment arrives. An
      // unresolvable range is dropped in silence, so the scroll above is what
      // renders the file and these frames are what catch it once it has. Each
      // attempt asks for the same place, so the one that lands is the only one
      // that moves anything.
      //
      // `start`, not `center`: the viewer puts a range aligned to the start
      // directly under its own sticky header, so the file at the top of the
      // screen is the file the fragment names. A centred range leaves the file
      // above it owning the top, and the tree, which reads the top, would then
      // mark a file the reviewer was not sent to.
      let attempts = 0;
      const step = () => {
        anchorFramesRef.current = null;
        viewer.scrollTo({
          type: 'range',
          id: itemId,
          range,
          align: 'start',
          behavior: 'instant',
        });
        attempts += 1;
        if (attempts < ANCHOR_RANGE_ATTEMPTS) {
          anchorFramesRef.current = requestAnimationFrame(step);
        }
      };
      anchorFramesRef.current = requestAnimationFrame(step);
    },
    [selectActiveItem]
  );

  const anchor = useDiffAnchor({
    entries: patch.data.entries,
    ready: patch.state === 'ready' && workersReady,
    onApply: handleApplyAnchor,
  });

  const handleSelectItem = useCallback(
    (itemId: string) => {
      const viewer = viewerRef.current;
      if (viewer == null) return;
      expandItem(viewer, itemId);
      selectActiveItem(itemId);
      // The address is what the reviewer can send to somebody else, so opening
      // a file goes into it and into the history.
      anchor.openItem(itemId);
      // That fragment names no lines, so the last highlight goes with it.
      clearViewerSelection(viewer, setSelectedLines);
      viewer.scrollTo({
        type: 'item',
        id: itemId,
        align: 'start',
        behavior: 'smooth',
      });
    },
    [anchor, selectActiveItem]
  );

  const handleSelectComment = useCallback(
    (comment: CommentListEntry) => {
      const viewer = viewerRef.current;
      if (viewer == null) return;
      selectActiveItem(comment.itemId);
      viewer.setSelectedLines({ id: comment.itemId, range: comment.range });
      viewer.scrollTo({
        type: 'line',
        id: comment.itemId,
        lineNumber: comment.range.end,
        side: comment.range.endSide ?? comment.range.side ?? comment.side,
        align: 'center',
        behavior: 'smooth-auto',
      });
    },
    [selectActiveItem]
  );

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
      anchor.syncSelection(next);
    },
    [anchor]
  );

  return (
    <>
      <ReviewHeader
        colorMode={colorMode}
        controls={controls}
        onControlsChange={setControls}
        pull={pullTarget == null ? undefined : pull}
        // PullRail renders nothing while the watch list is empty, and the bar's
        // own name is the way home. The header takes that job over when the bar
        // is away, so a review always has a route out of itself.
        showBrand={watched.hydrated && watched.repos.length === 0}
        review={pullTarget == null ? undefined : review}
        targetLabel={describeReviewTarget(target)}
        targetUrl={reviewTargetUrl(target)}
        // A verdict changes the review half of the square the left bar draws on
        // every row, so the list it came from is asked again.
        onReviewSubmitted={openPulls.reload}
        token={token}
      />

      {patch.state === 'ready' && workersReady ? (
        // The first column is a custom property rather than a fixed width,
        // because the drag writes that property straight onto this element and
        // never re-renders the diff beside it. See hooks/useSidebarWidth.ts.
        <div
          ref={attachLayout}
          className="bg-canvas relative grid min-h-0 flex-1 overflow-hidden"
          style={{
            ...sidebarStyle,
            gridTemplateColumns: `var(${SIDEBAR_WIDTH_PROPERTY}) minmax(0,1fr)`,
          }}
        >
          <ReviewSidebar
            activeItemId={activeItemId}
            activeThreadKey={activeThreadKey}
            authorCounts={authorCounts}
            authorFilter={authorMode}
            availableStatuses={statuses}
            colorScheme={colorMode.scheme}
            commentSections={listedSections}
            commentStore={comments.store}
            entries={patch.data.entries}
            filter={filter}
            hiddenCount={filtered.hiddenCount}
            onAuthorFilterChange={authorFilter.setValue}
            onFilterChange={setFilter}
            onSelectComment={handleSelectComment}
            onSelectItem={handleSelectItem}
            stats={filtered.stats}
            totalFileCount={patch.data.stats.fileCount}
            treeSource={filtered.treeSource}
            treeStats={treeStats}
          />
          <PaneResizeHandle
            label="Sidebar width"
            max={SIDEBAR_MAX_WIDTH}
            min={SIDEBAR_MIN_WIDTH}
            onKeyDown={onSidebarHandleKeyDown}
            onPointerDown={onSidebarHandlePointerDown}
            onReset={resetSidebarWidth}
            style={{ left: `calc(var(${SIDEBAR_WIDTH_PROPERTY}) - 4px)` }}
            width={sidebarWidth}
          />
          <ReviewViewer
            commentStore={comments.store}
            controls={controls}
            items={items}
            onCancelDraft={comments.removeComment}
            onCreateDraft={handleCreateDraft}
            onDeleteComment={comments.removeComment}
            onReplyToThread={comments.replyToThread}
            onSaveDraft={comments.saveDraft}
            onScroll={onDiffScroll}
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
          status={patch.status}
          target={target}
          token={token}
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

/** A collapsed file cannot be scrolled to, so open it before going there. */
function expandItem(
  viewer: CodeViewHandle<CommentMetadata>,
  itemId: string
): void {
  const item = viewer.getItem(itemId);
  if (item?.collapsed !== true) return;
  viewer.updateItem({
    ...item,
    collapsed: false,
    version: (item.version ?? 0) + 1,
  });
}

/**
 * Takes the highlight off the diff.
 *
 * The viewer reports a selection it was given, but not one it was told to
 * drop: `applySelectedLines` clears the item it is leaving with `notify` off.
 * So the state that mirrors the selection has to be set here, or the sidebar
 * would go on marking a thread the diff no longer has selected.
 */
function clearViewerSelection(
  viewer: CodeViewHandle<CommentMetadata>,
  setSelectedLines: (selection: CodeViewLineSelection | null) => void
): void {
  viewer.clearSelectedLines();
  setSelectedLines(null);
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
