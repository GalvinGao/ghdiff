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
import { DiffSearchBar } from '@/components/DiffSearchBar';
import { PaneResizeHandle } from '@/components/PaneResizeHandle';
import { ReviewHeader } from '@/components/ReviewHeader';
import { ReviewSidebar } from '@/components/ReviewSidebar';
import { ReviewStatusPanel } from '@/components/ReviewStatusPanel';
import { isSameSelection, ReviewViewer } from '@/components/ReviewViewer';
import { Button } from '@/components/ui/Button';
import { WatchOfferDialog } from '@/components/WatchOfferDialog';
import {
  commentAuthorFilterPreference,
  usePreference,
  viewerControlsPreference,
} from '@/hooks/preferences';
import { useActiveDiffItem } from '@/hooks/useActiveDiffItem';
import { type DiffAnchorTarget, useDiffAnchor } from '@/hooks/useDiffAnchor';
import { useDiffFileLoader } from '@/hooks/useDiffFileLoader';
import { useDiffSearch } from '@/hooks/useDiffSearch';
import { useIsPhone } from '@/hooks/useIsPhone';
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
import { useViewedFiles } from '@/hooks/useViewedFiles';
import { useWorkerPoolReady } from '@/hooks/useWorkerPoolReady';
import { cn } from '@/lib/cn';
import {
  countCommentAuthors,
  filterCommentSections,
} from '@/lib/commentAuthors';
import type { CommentListEntry, CommentMetadata } from '@/lib/comments';
import { buildCommentSections } from '@/lib/commentSections';
import type { SearchMatch } from '@/lib/diffSearch';
import { reviewTargetUrl } from '@/lib/githubUrls';
import {
  applyReviewFilter,
  availableStatuses,
  EMPTY_FILTER_STATE,
  type ReviewFilterState,
} from '@/lib/reviewFilter';
import {
  describeReviewTarget,
  type ReviewTarget,
  reviewTargetSplat,
} from '@/lib/reviewTarget';
import { buildTreeStatIndex } from '@/lib/treeStats';
import { defaultViewerControls } from '@/lib/viewerControls';

// Frames a range anchor is given to resolve. The scroll to the file is what
// renders it, and the range can only be measured once it has been. Four frames
// is long enough for that and short enough that a reviewer who starts scrolling
// straight away is not fought for it. A search jump takes the same four, for
// the file it opens on the way: the fold comes off on the render after the
// press, and a line asked for before that lands on the folded header.
const ANCHOR_RANGE_ATTEMPTS = 4;

const NO_ITEMS: ReadonlySet<string> = new Set<string>();

export function ReviewScreen({ target }: { target: ReviewTarget }) {
  // The left bar owns these, so the diff and the bar cannot disagree about who
  // the reviewer is signed in as or which repositories are watched.
  const {
    codeFont,
    colorMode,
    pulls: openPulls,
    session,
    watched,
  } = useAppData();
  const workersReady = useWorkerPoolReady();
  const isPhone = useIsPhone();
  // Null until the reviewer touches a control, which is what lets
  // `defaultViewerControls` follow the screen until then and stop following it
  // afterwards. The choice is remembered, so "until then" is the first press in
  // this browser and not the first press on this page.
  const { value: chosenControls, setValue: setControls } = usePreference(
    viewerControlsPreference
  );
  const controls = chosenControls ?? defaultViewerControls(isPhone);
  // The file list covers the diff on a phone instead of sitting beside it, so
  // it starts closed: the diff is what the reviewer came for.
  const [filesOpen, setFilesOpen] = useState(false);
  // The files folded shut, by item id. This is its own state and not a reading
  // of which files are marked read, because the two answer different
  // questions: a file the reviewer has read and then opened again is still
  // read, and a file folded from the header's own chevron was never marked.
  const [collapsedItemIds, setCollapsedItemIds] =
    useState<ReadonlySet<string>>(NO_ITEMS);
  const [filter, setFilter] = useState<ReviewFilterState>(EMPTY_FILTER_STATE);
  const [selectedLines, setSelectedLines] =
    useState<CodeViewLineSelection | null>(null);
  // The comment failure the reviewer has already read and waved away.
  const [dismissedError, setDismissedError] = useState<string | undefined>(
    undefined
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CodeViewHandle<CommentMetadata> | null>(null);
  // The frame waiting to ask the viewer for a place again. See runOnFrames.
  const frameLoopRef = useRef<number | null>(null);
  // The file a jump has opened since the marks were last read. See the fold
  // seed below, which is the only thing that reads it.
  const openedByJumpRef = useRef<string | undefined>(undefined);
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
  const { value: authorMode, setValue: setAuthorMode } = usePreference(
    commentAuthorFilterPreference
  );

  const patch = useReviewPatch({ target });
  // Depends on the three parts, not on the target: a server component hands the
  // target down, so its identity changes on every read of the RSC payload.
  const pullTarget = target.kind === 'github-pull' ? target : undefined;
  const pull = usePullDetails({
    number: pullTarget?.number,
    owner: pullTarget?.owner,
    repo: pullTarget?.repo,
  });
  const review = useSubmitReview({
    number: pullTarget?.number,
    owner: pullTarget?.owner,
    repo: pullTarget?.repo,
  });
  // Only reached when a reviewer expands a hunk's unmodified lines, so it costs
  // nothing on a review nobody expands.
  const files = useDiffFileLoader({ target });
  const comments = useReviewComments({
    target,
    entries: patch.data.entries,
    viewerLogin: session.viewer?.login,
    viewerAvatarUrl: session.viewer?.avatarUrl,
    ready: patch.state === 'ready',
  });
  // The whole patch, not the filtered list: a mark belongs to the file and not
  // to whichever files the filter is showing right now.
  const viewedFiles = useViewedFiles({
    target,
    entries: patch.data.entries,
    ready: patch.state === 'ready',
  });

  // A file already read starts folded, the way it does on github.com: what a
  // reviewer comes back to a review for is the files nobody has read yet. This
  // watches the marks the store reported and not the marks now, so a file
  // opened again from its chevron stays open until the store is read afresh —
  // which happens on a new target and on a new token, where a fold left over
  // from the review before would be about a different diff.
  //
  // One file is spared, and it has to be. A jump and this read race each other
  // on a pull request: the address is applied the moment the diff is on
  // screen, and the marks are a request that answers a moment later. Whichever
  // lands first, the file the reviewer was sent to stays open, because a fold
  // that shut it would leave them looking at a header.
  const loadedViewedItemIds = viewedFiles.loaded;
  useEffect(() => {
    const opened = openedByJumpRef.current;
    openedByJumpRef.current = undefined;
    setCollapsedItemIds(
      opened == null || !loadedViewedItemIds.has(opened)
        ? loadedViewedItemIds
        : new Set([...loadedViewedItemIds].filter((id) => id !== opened))
    );
  }, [loadedViewedItemIds]);

  const setCollapsed = useCallback((itemId: string, collapsed: boolean) => {
    setCollapsedItemIds((current) => {
      if (current.has(itemId) === collapsed) return current;
      const next = new Set(current);
      if (collapsed) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }, []);

  /**
   * Opens the file a jump lands on. A scroll to a folded file lands on its
   * header and shows nothing, so every jump — a row in the tree, a thread in
   * the comment list, a fragment in the address — comes through here.
   */
  const openFile = useCallback(
    (itemId: string) => {
      openedByJumpRef.current = itemId;
      setCollapsed(itemId, false);
    },
    [setCollapsed]
  );

  // A mark folds the file, and taking the mark back opens it, which is what
  // github.com does and what makes the mark worth making: a diff read from the
  // top gets shorter as the reviewer goes down it.
  const setViewedFile = viewedFiles.setViewed;
  const handleToggleViewed = useCallback(
    (itemId: string, viewed: boolean) => {
      setViewedFile(itemId, viewed);
      setCollapsed(itemId, viewed);
    },
    [setCollapsed, setViewedFile]
  );

  const filtered = useMemo(
    () => applyReviewFilter(patch.data, filter),
    [filter, patch.data]
  );

  // CodeView keys an update off id and version, so a change to either of the
  // two things this screen writes onto an item — its comments and whether it is
  // folded — must move the version of the item that carries it. Doubling the
  // comment revision leaves the low bit for the fold, so neither can hide a
  // change in the other. Only the items that carry something are rebuilt, and
  // the rest keep their identity: the viewer relays out from the first item
  // whose version moved, and rebuilding all of them would relay out the diff.
  const items = useMemo<readonly CodeViewDiffItem<CommentMetadata>[]>(() => {
    if (
      comments.annotationsByItemId.size === 0 &&
      collapsedItemIds.size === 0
    ) {
      return filtered.items;
    }
    return filtered.items.map((item) => {
      const annotations = comments.annotationsByItemId.get(item.id);
      const collapsed = collapsedItemIds.has(item.id);
      if (annotations == null && !collapsed) return item;
      return {
        ...item,
        ...(annotations == null ? {} : { annotations: [...annotations] }),
        collapsed,
        version: comments.revision * 2 + (collapsed ? 1 : 0),
      };
    });
  }, [
    collapsedItemIds,
    comments.annotationsByItemId,
    comments.revision,
    filtered.items,
  ]);

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

  const stopFrameLoop = useCallback(() => {
    if (frameLoopRef.current != null) {
      cancelAnimationFrame(frameLoopRef.current);
      frameLoopRef.current = null;
    }
  }, []);

  useEffect(() => stopFrameLoop, [stopFrameLoop]);

  /**
   * Asks the viewer for the same place on each of the next few frames. A line
   * or a range resolves only once the viewer has laid the file out the way it
   * will be drawn, and the press that asks for it is often the press that
   * changes that layout: a scroll that renders the file, a fold coming off.
   * Each attempt asks for the same place, so the one that lands is the only
   * one that moves anything. One loop at a time: a new jump cancels the frames
   * the last one still had.
   */
  const runOnFrames = useCallback(
    (step: () => void) => {
      stopFrameLoop();
      let remaining = ANCHOR_RANGE_ATTEMPTS;
      const tick = () => {
        frameLoopRef.current = null;
        step();
        remaining -= 1;
        if (remaining > 0) frameLoopRef.current = requestAnimationFrame(tick);
      };
      frameLoopRef.current = requestAnimationFrame(tick);
    },
    [stopFrameLoop]
  );

  /**
   * What every jump does before it scrolls. The file list is closed, because
   * on a phone it is over the diff and the jump is a request to see the diff.
   * The file is opened, because a scroll to a folded file lands on its header.
   * And the tree is told, because a scroll the viewer was asked to make is one
   * it never reports.
   */
  const landOn = useCallback(
    (itemId: string) => {
      setFilesOpen(false);
      openFile(itemId);
      selectActiveItem(itemId);
    },
    [openFile, selectActiveItem]
  );

  // Puts the reviewer where the URL fragment says. A fragment that names lines
  // highlights them; one that names only a file takes the highlight away, so
  // the address and the diff never disagree about what is marked.
  const handleApplyAnchor = useCallback(
    (anchored: DiffAnchorTarget | null) => {
      const viewer = viewerRef.current;
      stopFrameLoop();
      if (viewer == null) return;
      if (anchored == null) {
        clearViewerSelection(viewer, setSelectedLines);
        return;
      }
      openFile(anchored.itemId);
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
      // renders the file and these frames are what catch it once it has.
      //
      // `start`, not `center`: the viewer puts a range aligned to the start
      // directly under its own sticky header, so the file at the top of the
      // screen is the file the fragment names. A centred range leaves the file
      // above it owning the top, and the tree, which reads the top, would then
      // mark a file the reviewer was not sent to.
      runOnFrames(() => {
        viewer.scrollTo({
          type: 'range',
          id: itemId,
          range,
          align: 'start',
          behavior: 'instant',
        });
      });
    },
    [openFile, runOnFrames, selectActiveItem, stopFrameLoop]
  );

  // Puts a search match on screen. Centred, unlike an anchor: a match is a
  // place to look at, not a place to start reading from, and the lines around
  // it are what say whether it is the one the reviewer wanted. Instant, the
  // way the browser's own find moves, so a run of Enter presses steps rather
  // than glides. The line is asked for now and again on the next frames — the
  // file may be folded, and the fold comes off on the render after this.
  const handleSearchJump = useCallback(
    (match: SearchMatch) => {
      const viewer = viewerRef.current;
      if (viewer == null) return;
      landOn(match.itemId);
      const place = {
        type: 'line',
        id: match.itemId,
        lineNumber: match.lineNumber,
        side: match.side,
        align: 'center',
        behavior: 'instant',
      } as const;
      viewer.scrollTo(place);
      runOnFrames(() => viewer.scrollTo(place));
    },
    [landOn, runOnFrames]
  );

  // Over the filtered items and not the annotated ones: the marks and the folds
  // are written onto a new array on every change, and a search that re-ran for
  // each of them would re-pick its match every time a file was folded.
  const diffReady = patch.state === 'ready' && workersReady;

  const search = useDiffSearch({
    items: filtered.items,
    diffStyle: controls.diffStyle,
    ready: diffReady,
    activeItemId,
    onJump: handleSearchJump,
    // The list is over the diff on a phone, and the bar is in the diff's
    // column, so a search opened under it would go to a field nobody can see.
    onShow: () => setFilesOpen(false),
  });

  const anchor = useDiffAnchor({
    entries: patch.data.entries,
    ready: diffReady,
    onApply: handleApplyAnchor,
  });

  const handleSelectItem = useCallback(
    (itemId: string) => {
      const viewer = viewerRef.current;
      if (viewer == null) return;
      landOn(itemId);
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
    [anchor, landOn]
  );

  const handleSelectComment = useCallback(
    (comment: CommentListEntry) => {
      const viewer = viewerRef.current;
      if (viewer == null) return;
      landOn(comment.itemId);
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
    [landOn]
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
        codeFont={codeFont}
        colorMode={colorMode}
        controls={controls}
        // The file list is a column of its own on every wider screen, which
        // needs no control to show it. Handing these down only on a phone is
        // what keeps that button off a screen that has no use for it.
        filesOpen={isPhone ? filesOpen : undefined}
        onToggleFiles={
          isPhone ? () => setFilesOpen((open) => !open) : undefined
        }
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
        session={session}
      />

      {diffReady ? (
        // The first column is a custom property rather than a fixed width,
        // because the drag writes that property straight onto this element and
        // never re-renders the diff beside it. See hooks/useSidebarWidth.ts.
        <div
          ref={attachLayout}
          className="bg-canvas relative grid min-h-0 flex-1 overflow-hidden"
          style={{
            ...sidebarStyle,
            // One column on a phone. The file list is not beside the diff
            // there, it is over it, so it takes no track of its own.
            gridTemplateColumns: isPhone
              ? 'minmax(0,1fr)'
              : `var(${SIDEBAR_WIDTH_PROPERTY}) minmax(0,1fr)`,
            // The whole effect of the dim switch. The marks are stamped on
            // rows inside the viewer's shadow roots and styled by
            // LINE_MARKS_CSS, whose default is the on state; this property
            // inherits through the shadow boundary and overrides it, so a
            // toggle is one style write and never a re-render of the diff.
            ...(controls.dimWhitespace
              ? undefined
              : { '--ghdiff-quiet-opacity': '1' }),
          }}
        >
          <ReviewSidebar
            activeItemId={activeItemId}
            // Over the diff rather than beside it, and gone rather than
            // narrow. `hidden` and not unmounted: the tab, the filter and the
            // scroll a reviewer left the list at are all still there the next
            // time they open it. The viewer underneath keeps its own box
            // either way, so nothing about the diff is measured again.
            className={
              isPhone
                ? cn('absolute inset-0 z-20 border-r-0', !filesOpen && 'hidden')
                : undefined
            }
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
            onAuthorFilterChange={setAuthorMode}
            onFilterChange={setFilter}
            onSelectComment={handleSelectComment}
            onSelectItem={handleSelectItem}
            stats={filtered.stats}
            totalFileCount={patch.data.stats.fileCount}
            treeSource={filtered.treeSource}
            treeStats={treeStats}
          />
          {/* No seam on a phone: the two panes are not side by side there,
              and there is no width to drag. */}
          {!isPhone && (
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
          )}
          {/* The diff's column: the search bar, when it is open, and the diff
              under it. The bar takes its row from the diff rather than float
              over it, so nothing in the sticky header is covered while a
              reviewer searches. See DiffSearchBar. */}
          <div className="flex min-h-0 min-w-0 flex-col">
            {search.open && <DiffSearchBar search={search} />}
            <ReviewViewer
              commentStore={comments.store}
              controls={controls}
              items={items}
              loadDiffFiles={files.loadDiffFiles}
              onCancelDraft={comments.removeComment}
              onCreateDraft={handleCreateDraft}
              onDeleteComment={comments.removeComment}
              onReplyToThread={comments.replyToThread}
              onSaveDraft={comments.saveDraft}
              onScroll={onDiffScroll}
              onSelectedLinesChange={handleSelectedLinesChange}
              onToggleCollapsed={setCollapsed}
              onToggleViewed={handleToggleViewed}
              scrollRef={scrollRef}
              searchMarks={search.marks}
              selectedLines={selectedLines}
              collapsedItemIds={collapsedItemIds}
              themeType={colorMode.hydrated ? colorMode.mode : 'system'}
              viewedItemIds={viewedFiles.viewed}
              viewerRef={viewerRef}
            />
          </div>
        </div>
      ) : (
        <ReviewStatusPanel
          // Only while the patch is still coming down. The parse and the
          // highlighters are not measured in bytes, and a figure that stayed on
          // screen through them would read as a download that had stalled.
          bytes={patch.state === 'fetching' ? patch.bytes : undefined}
          error={patch.error}
          onRetry={patch.retry}
          state={patch.state === 'ready' ? 'starting' : patch.state}
          status={patch.status}
          target={target}
          targetPath={`/${reviewTargetSplat(target)}`}
          session={session}
        />
      )}

      {patch.notice != null && (
        <ReviewNotice tone="muted">{patch.notice}</ReviewNotice>
      )}
      {/* A sign-in comes back to the diff it left from, so a sign-in that
          failed has to say so here. It is the same strip a failed comment
          lands on, and it is dismissable for the same reason: the diff is
          still readable and the reviewer may simply press Sign in again. */}
      {session.authError != null && session.authError !== dismissedError && (
        <ReviewNotice
          onDismiss={() => setDismissedError(session.authError)}
          tone="error"
        >
          {session.authError}
        </ReviewNotice>
      )}
      {comments.error != null && comments.error !== dismissedError && (
        <ReviewNotice
          onDismiss={() => setDismissedError(comments.error)}
          tone="error"
        >
          {comments.error}
        </ReviewNotice>
      )}
      {files.error != null && (
        <ReviewNotice onDismiss={files.dismissError} tone="error">
          {files.error}
        </ReviewNotice>
      )}
      {viewedFiles.error != null && (
        <ReviewNotice onDismiss={viewedFiles.dismissError} tone="error">
          {viewedFiles.error}
        </ReviewNotice>
      )}

      {/* The offer of a watch list, for a reviewer who has none. It asks
          nothing until the diff is up: a modal over `ReviewStatusPanel` would
          be a question stacked on a failure. See WatchOfferDialog. */}
      <WatchOfferDialog
        owner={target.owner}
        ready={patch.state === 'ready'}
        repo={target.repo}
      />
    </>
  );
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
