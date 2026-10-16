import {
  type AnnotationSide,
  areSelectionsEqual,
  type CodeViewDiffItem,
  type CodeViewLineSelection,
  type SelectedLineRange,
} from '@pierre/diffs';
import type { CodeViewHandle } from '@pierre/diffs/react';
import { IconCiWarningFill, IconXSquircle } from '@pierre/icons';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAppData } from '@/components/AppDataProvider';
import { AttachmentsProvider } from '@/components/CommentBody';
import { CommentExpansion } from '@/components/CommentExpansion';
import { ExpandedThread } from '@/components/CommentThreadCard';
import { DiffSearchBar } from '@/components/DiffSearchBar';
import {
  LocalizationPanel,
  localizationGroupId,
} from '@/components/lenses/LocalizationPanel';
import { LocalizationSettingsDialog } from '@/components/lenses/LocalizationSettingsDialog';
import { PaneResizeHandle } from '@/components/PaneResizeHandle';
import { ReviewHeader } from '@/components/ReviewHeader';
import { ReviewSidebar } from '@/components/ReviewSidebar';
import { ReviewStatusPanel } from '@/components/ReviewStatusPanel';
import { isSameSelection, ReviewViewer } from '@/components/ReviewViewer';
import { Button } from '@/components/ui/Button';
import { Toast } from '@/components/ui/Toast';
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
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { gitLabConnectionFor } from '@/hooks/useGitHubSession';
import { useIsPhone } from '@/hooks/useIsPhone';
import { usePullConversation } from '@/hooks/usePullConversation';
import { usePullDetails } from '@/hooks/usePullDetails';
import { useRepoLenses } from '@/hooks/useRepoLenses';
import { useReviewComments } from '@/hooks/useReviewComments';
import { useReviewFavicon } from '@/hooks/useReviewFavicon';
import {
  type ReviewFilterUpdate,
  useReviewFilter,
} from '@/hooks/useReviewFilter';
import { useReviewPatch } from '@/hooks/useReviewPatch';
import {
  SIDEBAR_HEIGHT_PROPERTY,
  SIDEBAR_MAX_HEIGHT,
  SIDEBAR_MIN_HEIGHT,
  useSidebarHeight,
} from '@/hooks/useSidebarHeight';
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_PROPERTY,
  useSidebarWidth,
} from '@/hooks/useSidebarWidth';
import { useStackHandoff } from '@/hooks/useStackHandoff';
import { useSubmitReview } from '@/hooks/useSubmitReview';
import { useViewedFiles } from '@/hooks/useViewedFiles';
import { useWorkerPoolReady } from '@/hooks/useWorkerPoolReady';
import { buildAgentPrompt } from '@/lib/agentPrompt';
import { cn } from '@/lib/cn';
import {
  countCommentAuthors,
  filterCommentSections,
} from '@/lib/commentAuthors';
import {
  type CommentListEntry,
  type CommentMetadata,
  MERGE_REQUEST_ITEM_ID,
} from '@/lib/comments';
import {
  buildCommentSections,
  buildMergeRequestSection,
} from '@/lib/commentSections';
import type { SearchMatch } from '@/lib/diffSearch';
import {
  forgeOfTarget,
  isGitLabTarget,
  pullRefFromTarget,
  reviewCapabilities,
} from '@/lib/forges';
import { GITHUB_HOSTS } from '@/lib/github/hosts';
import { applyLenses, LENSES, type LensFile } from '@/lib/lenses/lenses';
import type { LocalizationSettings } from '@/lib/lenses/localization/config';
import {
  addConversationAuthors,
  filterConversation,
} from '@/lib/pullConversation';
import type { WatchedRepo } from '@/lib/pulls';
import type { ReviewEvent } from '@/lib/reviewDecision';
import { applyReviewFilter, availableStatuses } from '@/lib/reviewFilter';
import {
  describeReviewTarget,
  isForgeTarget,
  repoNameFromRoot,
  reviewTabTitle,
  reviewTabType,
  type ReviewTarget,
  reviewTargetKey,
  reviewTargetSplat,
} from '@/lib/reviewTarget';
import { stackPosition, stackPullTarget } from '@/lib/stackReview';
import { buildTreeStatIndex } from '@/lib/treeStats';
import { defaultViewerControls } from '@/lib/viewerControls';
import { m } from '@/paraglide/messages.js';

// Frames a range anchor is given to resolve. The scroll to the file is what
// renders it, and the range can only be measured once it has been. Four frames
// is long enough for that and short enough that a reviewer who starts scrolling
// straight away is not fought for it. A search jump takes the same four, for
// the file it opens on the way: the fold comes off on the render after the
// press, and a line asked for before that lands on the folded header.
const ANCHOR_RANGE_ATTEMPTS = 4;

const NO_ITEMS: ReadonlySet<string> = new Set<string>();

/** What the toast after an approval reports. */
interface ApprovalToast {
  /** The pull request that was approved. */
  approved: number;
  /** Whether its link reached the clipboard. */
  linkCopied?: boolean;
  /**
   * Where Approve went inside a stack: the layer this screen now shows, or the
   * end of the stack. Absent for a pull request with no stack.
   */
  stack?: 'last' | { number: number; position: number; total: number };
}

/**
 * The approval in one sentence, and then the link in another. Two messages and
 * not one per pairing, so the second sentence is written once; the pair joins
 * through a message of its own, because Chinese and Japanese put no space
 * between two sentences.
 */
function describeApproval(toast: ApprovalToast): string {
  const { approved, stack } = toast;
  const verdict =
    stack == null
      ? m.review_approved({ approved })
      : stack === 'last'
        ? m.review_stack_approved_last({ approved })
        : m.review_stack_approved_next({ approved, ...stack });
  if (toast.linkCopied == null) return verdict;
  return m.review_two_sentences({
    first: verdict,
    second: toast.linkCopied
      ? m.review_link_copied()
      : m.review_link_not_copied(),
  });
}

export function ReviewScreen({
  target,
  untrackedPaths,
}: {
  target: ReviewTarget;
  /**
   * The files git is not tracking, from the host that read the working tree.
   * Only the `ghdiff` command passes any; on the hosted side there is no such
   * file to name.
   */
  untrackedPaths?: readonly string[];
}) {
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
  // True while the files a lens claimed are drawn in the diff as files. Not a
  // filter: the files stay in the tree either way, and only the form they are
  // read in changes.
  const [lensFilesShown, setLensFilesShown] = useState(false);
  const [localizationOpen, setLocalizationOpen] = useState(false);
  // The settings from before the reviewer pressed Turn off, held for as long
  // as the toast that says where the switch went and offers to undo it.
  const [localizationBeforeOff, setLocalizationBeforeOff] =
    useState<LocalizationSettings | null>(null);
  const [selectedLines, setSelectedLines] =
    useState<CodeViewLineSelection | null>(null);
  // The comment failure the reviewer has already read and waved away.
  const [dismissedError, setDismissedError] = useState<string | undefined>(
    undefined
  );
  // The merge-request thread open over its sidebar row, if one is. Only the
  // row and the thread's key are held: the metadata is read live at render, so
  // a reply, a pending mark or a failure shows as it lands — and the panel is
  // gone with the thread, where a snapshot would outlive it.
  const [mergeRequestThread, setMergeRequestThread] = useState<{
    anchor: HTMLElement;
    key: string;
  } | null>(null);
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
    attach: attachSidebarWidth,
    onHandleKeyDown: onSidebarHandleKeyDown,
    onHandlePointerDown: onSidebarHandlePointerDown,
    reset: resetSidebarWidth,
    style: sidebarWidthStyle,
    width: sidebarWidth,
  } = useSidebarWidth();
  // The same sidebar, as a band above the diff on a portrait screen. Both
  // hooks stay mounted and both properties stay painted; the stylesheet's
  // track template is what decides which one the layout reads.
  const {
    attach: attachSidebarHeight,
    onHandleKeyDown: onBandHandleKeyDown,
    onHandlePointerDown: onBandHandlePointerDown,
    reset: resetSidebarHeight,
    style: sidebarHeightStyle,
    width: sidebarHeight,
  } = useSidebarHeight();
  const attachLayout = useCallback(
    (node: HTMLElement | null) => {
      attachSidebarWidth(node);
      attachSidebarHeight(node);
    },
    [attachSidebarHeight, attachSidebarWidth]
  );
  const { value: authorMode, setValue: setAuthorMode } = usePreference(
    commentAuthorFilterPreference
  );

  const patch = useReviewPatch({ target, untracked: untrackedPaths });
  // The watch-list offer names a repository on a forge, and a local diff has
  // none. The header and the status panel ask the target this themselves rather
  // than be told, so the three cannot come to disagree.
  const forgeTarget = isForgeTarget(target) ? target : undefined;
  const targetKey = reviewTargetKey(target);
  // Depends on the ref, not on the target: a server component hands the target
  // down, so its identity changes on every read of the RSC payload.
  const pullRef = useMemo(
    () => pullRefFromTarget(target),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetKey]
  );
  const pullTarget =
    target.kind === 'github-pull' || target.kind === 'gitlab-mr'
      ? target
      : undefined;
  // What this target can do with comments, drafts, and verdicts. A commit and
  // a compare range have no review thread on their forge: their comments stay
  // in this browser, and no draft or verdict control is offered.
  const capabilities = useMemo(
    () => reviewCapabilities(target),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetKey]
  );
  const forge = forgeTarget == null ? 'github' : forgeOfTarget(forgeTarget);
  const pull = usePullDetails({ ref: pullRef });
  // The tab belongs to the review on screen: its title names the change — the
  // pull request's own title once it is read, a local diff by its repository
  // and range — and its favicon is badged with the kind of diff and, once the
  // details answer, the head commit's checks. Both go back to the app's own
  // when it leaves. The route keys this screen by its target, so these details
  // are never the previous pull request's.
  useDocumentTitle(
    reviewTabTitle(target, pullRef == null ? undefined : pull.data?.title)
  );
  useReviewFavicon({
    type: reviewTabType(target),
    draft: pull.data?.state === 'draft',
    check: pull.data?.check,
  });
  const review = useSubmitReview({ ref: pullRef });
  const conversation = usePullConversation({ ref: pullRef });
  const navigate = useNavigate();
  // Where this pull request sits in its stack. Read off the same list the left
  // bar draws, so the layer Approve goes on to is the row under this one there.
  const stack = useMemo(
    () => stackPosition(openPulls.data?.pulls ?? [], pullTarget),
    [openPulls.data, pullTarget]
  );
  // What the last approval did, for the toast that reports it: handed over by
  // the screen before when it opened this one as the next layer of a stack, or
  // set here when Approve stayed put.
  const [handoff, setHandoff] = useStackHandoff();
  const [approvalToast, setApprovalToast] = useState<ApprovalToast | null>(
    () =>
      handoff?.on === targetKey
        ? {
            approved: handoff.approved,
            linkCopied: handoff.linkCopied,
            stack: {
              number: handoff.number,
              position: handoff.position,
              total: handoff.total,
            },
          }
        : null
  );
  // Taken once, on arrival. A handoff this screen was not meant for is stale
  // by now, and one left in the atom would be reported on the next visit.
  useEffect(() => {
    setHandoff(null);
  }, [setHandoff]);
  const onReviewSubmitted = (event: ReviewEvent, linkCopied?: boolean) => {
    // A verdict is a new entry in the conversation, so that is asked again.
    // The rail and the comments are `onReviewSettled`'s, which runs on every
    // attempt, the failures included.
    conversation.reload();
    if (event !== 'APPROVE' || pullTarget == null) return;
    // An approval copies its link, and a copy looks exactly like nothing
    // happening, so every approval gets a toast that says where the link went.
    const next = stack?.next;
    if (stack == null || next == null) {
      setApprovalToast({
        approved: pullTarget.number,
        linkCopied,
        stack: stack == null ? undefined : 'last',
      });
      return;
    }
    const nextTarget = stackPullTarget(next);
    setHandoff({
      approved: pullTarget.number,
      linkCopied,
      on: reviewTargetKey(nextTarget),
      number: next.number,
      position: stack.position + 1,
      total: stack.total,
    });
    void navigate({
      to: '/$',
      params: { _splat: reviewTargetSplat(nextTarget) },
    });
  };
  // Only reached when a reviewer expands a hunk's unmodified lines, so it costs
  // nothing on a review nobody expands.
  const files = useDiffFileLoader({ target });
  // Whose name and picture a comment written here carries before the forge
  // answers: the GitHub viewer for a GitHub target, and for a GitLab one the
  // host's own connection — a GitLab author and the GitHub viewer are not the
  // same person just because they share a login.
  const commentViewer =
    forgeTarget == null
      ? session.viewer
      : isGitLabTarget(forgeTarget)
        ? gitLabConnectionFor(session.gitlab, forgeTarget.host)?.viewer
        : session.viewer;
  const comments = useReviewComments({
    target,
    entries: patch.data.entries,
    viewerLogin: commentViewer?.login,
    viewerAvatarUrl: commentViewer?.avatarUrl,
    ready: patch.state === 'ready',
    // The GitLab create paths read the patch itself to state a comment's
    // diff position as raw cursors; every other target never asks for it.
    patchText: patch.text,
    // While a verdict is in flight every comment write is blocked: the
    // verdict publishes what the forge holds, and a write that lands
    // mid-submit is one its answer cannot account for.
    verdictPending: review.pending != null,
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

  const statuses = useMemo(
    () => availableStatuses(patch.data.entries),
    [patch.data.entries]
  );
  // The filter this diff was left with, read back so a pull request opens with
  // the same files on screen as last time.
  const [filter, setStoredFilter] = useReviewFilter(targetKey, statuses);
  // Files a URL fragment named while the filter hid them. They stay on screen
  // until the reviewer changes the filter, which is an answer about what they
  // want to see now.
  const [keptItemIds, setKeptItemIds] = useState<ReadonlySet<string>>(NO_ITEMS);
  const setFilter = useCallback(
    (update: ReviewFilterUpdate) => {
      setKeptItemIds(NO_ITEMS);
      setStoredFilter(update);
    },
    [setStoredFilter]
  );
  const filtered = useMemo(
    () => applyReviewFilter(patch.data, filter, keptItemIds),
    [filter, keptItemIds, patch.data]
  );

  // The lenses read what the filter left, so a file the filter hid is neither
  // in the diff nor in a panel, and the two panes still agree.
  const repoLenses = useRepoLenses(target);
  const lensFiles = useMemo<LensFile[]>(() => {
    const itemById = new Map(filtered.items.map((item) => [item.id, item]));
    return filtered.entries.flatMap((entry) => {
      const item = itemById.get(entry.itemId);
      return item == null
        ? []
        : [{ itemId: entry.itemId, path: entry.path, fileDiff: item.fileDiff }];
    });
  }, [filtered.entries, filtered.items]);
  const lenses = useMemo(
    () => applyLenses(lensFiles, repoLenses.settings),
    [lensFiles, repoLenses.settings]
  );
  const lensHiddenItemIds = lensFilesShown ? NO_ITEMS : lenses.claimedItemIds;
  const viewerItems = useMemo(
    () =>
      lensHiddenItemIds.size === 0
        ? filtered.items
        : filtered.items.filter((item) => !lensHiddenItemIds.has(item.id)),
    [filtered.items, lensHiddenItemIds]
  );
  // The repository the lens settings belong to, as the settings name it.
  const repoLabel =
    forgeTarget == null
      ? target.kind === 'local-diff'
        ? repoNameFromRoot(target.root)
        : ''
      : isGitLabTarget(forgeTarget)
        ? `${forgeTarget.host}/${forgeTarget.project}`
        : `${forgeTarget.owner}/${forgeTarget.repo}`;
  const patchPaths = useMemo(
    () => patch.data.entries.map((entry) => entry.path),
    [patch.data.entries]
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
      return viewerItems;
    }
    return viewerItems.map((item) => {
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
    viewerItems,
  ]);

  const commentSections = useMemo(() => {
    const sections = buildCommentSections(
      patch.data.items,
      comments.annotationsByItemId,
      patch.data.entries
    );
    const mergeRequestSection = buildMergeRequestSection(
      comments.annotationsByItemId.get(MERGE_REQUEST_ITEM_ID) ?? []
    );
    return mergeRequestSection == null
      ? sections
      : [mergeRequestSection, ...sections];
  }, [comments.annotationsByItemId, patch.data.entries, patch.data.items]);

  // Every thread in the diff, and the subset the sidebar lists. The counts come
  // from the whole set, so the buttons still say how many the other filter
  // holds while one of them is on.
  const authorCounts = useMemo(
    () =>
      addConversationAuthors(
        countCommentAuthors(commentSections),
        conversation.entries
      ),
    [commentSections, conversation.entries]
  );
  const listedSections = useMemo(
    () => filterCommentSections(commentSections, authorMode),
    [authorMode, commentSections]
  );
  const listedConversation = useMemo(
    () => filterConversation(conversation.entries, authorMode),
    [authorMode, conversation.entries]
  );

  // Read from the filtered list, not from the whole patch. The filter drives
  // both panes, so a directory total has to be the sum of the rows listed under
  // it: a folder reporting lines from a file the filter hid would contradict
  // its own children.
  const treeStats = useMemo(
    () => buildTreeStatIndex(filtered.entries),
    [filtered.entries]
  );

  /**
   * The whole review as text for a coding agent.
   *
   * Built on the press and not before: it walks every thread's hunks for the
   * lines it quotes, and a reviewer who never presses this should pay nothing
   * for it. It reads `commentSections` rather than `listedSections`, because
   * the author filter is about what is comfortable to read in the panel and
   * says nothing about which notes are worth acting on.
   */
  const copyPrompt = useCallback(async () => {
    const fileDiffById = new Map(
      patch.data.items.map((item) => [item.id, item.fileDiff] as const)
    );
    const prompt = buildAgentPrompt({
      sections: commentSections,
      fileDiffById,
      targetLabel: describeReviewTarget(target),
      named: comments.store === 'forge',
    });
    if (prompt == null) return false;
    try {
      await navigator.clipboard.writeText(prompt);
      return true;
    } catch {
      // The clipboard is one of the few browser APIs that can simply refuse.
      // The button says so; there is nothing to do about it here.
      return false;
    }
  }, [comments.store, commentSections, patch.data.items, target]);

  // Counted off the patch and not off `untrackedPaths`: the list is what the
  // working tree held a moment before the diff was taken, and this is how many
  // of those files the patch actually carries. The switch is drawn from it, so
  // a diff with none never offers one.
  const untrackedCount = useMemo(
    () =>
      patch.data.entries.filter((entry) => entry.status === 'untracked').length,
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

  // Read by the jump handlers through a ref, so a rebuilt lens model does not
  // hand the tree and the comment list a new handler each time.
  const lensHiddenRef = useRef(lensHiddenItemIds);
  useEffect(() => {
    lensHiddenRef.current = lensHiddenItemIds;
  }, [lensHiddenItemIds]);

  /**
   * Puts a file a lens drew as a table back into the diff, for a jump that has
   * to land on one of its lines. True when it did, which tells the caller that
   * the file has no rows until the next render and the jump must wait for the
   * frames after it.
   */
  const filteredIdsRef = useRef<ReadonlySet<string>>(NO_ITEMS);
  const filteredIds = useMemo(
    () => new Set(filtered.items.map((item) => item.id)),
    [filtered.items]
  );
  useEffect(() => {
    filteredIdsRef.current = filteredIds;
  }, [filteredIds]);
  /**
   * Puts a file the filter hides back on screen for this visit, and answers
   * whether it had to. The stored filter is left alone: the link is about one
   * file, not about how this reviewer reads the diff.
   */
  const revealFilteredFile = useCallback((itemId: string) => {
    if (filteredIdsRef.current.has(itemId)) return false;
    setKeptItemIds((kept) => new Set(kept).add(itemId));
    return true;
  }, []);

  const revealLensFile = useCallback((itemId: string) => {
    if (!lensHiddenRef.current.has(itemId)) return false;
    setLensFilesShown(true);
    return true;
  }, []);

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
      // Both run: a file can be hidden by the filter and claimed by a lens.
      const hiddenByFilter = revealFilteredFile(itemId);
      const claimedByLens = revealLensFile(itemId);
      if (hiddenByFilter || claimedByLens) {
        runOnFrames(() => {
          if (range != null) viewer.setSelectedLines({ id: itemId, range });
          viewer.scrollTo({
            type: 'item',
            id: itemId,
            align: 'start',
            behavior: 'instant',
          });
          if (range != null) {
            viewer.scrollTo({
              type: 'range',
              id: itemId,
              range,
              align: 'start',
              behavior: 'instant',
            });
          }
        });
        return;
      }
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
    [
      openFile,
      revealFilteredFile,
      revealLensFile,
      runOnFrames,
      selectActiveItem,
      stopFrameLoop,
    ]
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

  // Over the drawn items and not the annotated ones: the marks and the folds
  // are written onto a new array on every change, and a search that re-ran for
  // each of them would re-pick its match every time a file was folded.
  const diffReady = patch.state === 'ready' && workersReady;

  const search = useDiffSearch({
    // The files the diff draws. A file a lens claimed is read in its panel,
    // and a match inside it would have no row to land on.
    items: viewerItems,
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

  const localizationGroups = lenses.models.localization.groups;
  const handleSelectItem = useCallback(
    (itemId: string) => {
      const viewer = viewerRef.current;
      if (viewer == null) return;
      // A file read in a lens panel is a row of the panel, not a file of the
      // diff, so the tree goes to the panel. The address is left alone: a
      // fragment names a file of the diff, and following it back would put
      // the file into the diff.
      if (lensHiddenRef.current.has(itemId)) {
        setFilesOpen(false);
        const group = localizationGroups.find((entry) =>
          entry.itemIds.includes(itemId)
        );
        const root = scrollRef.current;
        const element =
          group == null
            ? null
            : document.getElementById(
                localizationGroupId(group.source.pattern)
              );
        if (root == null || element == null) return;
        viewer.scrollTo({
          type: 'position',
          position:
            element.getBoundingClientRect().top -
            root.getBoundingClientRect().top +
            root.scrollTop,
          behavior: 'smooth',
        });
        return;
      }
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
    [anchor, landOn, localizationGroups]
  );

  const handleSelectComment = useCallback(
    (comment: CommentListEntry, rowAnchor?: HTMLElement) => {
      // A thread on the merge request itself is no annotation in the diff, so
      // there is nothing to scroll to: the card opens over the row instead.
      if (comment.scope === 'merge-request') {
        if (rowAnchor == null) return;
        setMergeRequestThread({ anchor: rowAnchor, key: comment.key });
        return;
      }
      const viewer = viewerRef.current;
      if (viewer == null || comment.range == null) return;
      const range = comment.range;
      landOn(comment.itemId);
      const revealed = revealLensFile(comment.itemId);
      const land = () => {
        viewer.setSelectedLines({ id: comment.itemId, range });
        viewer.scrollTo({
          type: 'line',
          id: comment.itemId,
          lineNumber: range.end,
          side: range.endSide ?? range.side ?? comment.side,
          align: 'center',
          behavior: revealed ? 'instant' : 'smooth-auto',
        });
      };
      if (revealed) runOnFrames(land);
      else land();
    },
    [landOn, revealLensFile, runOnFrames]
  );

  // A row of a lens panel, sent to its own line of the patch. The line is
  // selected as well as shown, which writes it into the address and puts the
  // comment control under the reviewer's pointer.
  const handleLensJump = useCallback(
    (itemId: string, side: AnnotationSide, lineNumber: number) => {
      const viewer = viewerRef.current;
      if (viewer == null) return;
      revealLensFile(itemId);
      landOn(itemId);
      const range = { start: lineNumber, end: lineNumber, side };
      runOnFrames(() => {
        viewer.setSelectedLines({ id: itemId, range });
        viewer.scrollTo({
          type: 'line',
          id: itemId,
          lineNumber,
          side,
          align: 'center',
          behavior: 'instant',
        });
      });
    },
    [landOn, revealLensFile, runOnFrames]
  );

  const localizationSettings = repoLenses.get('localization');
  const setRepoLens = repoLenses.set;
  const setLocalizationSettings = useCallback(
    (next: LocalizationSettings) => setRepoLens('localization', next),
    [setRepoLens]
  );
  const openLocalization = useCallback(() => setLocalizationOpen(true), []);
  const turnOffLocalization = useCallback(() => {
    setLocalizationBeforeOff(localizationSettings);
    setLocalizationSettings({ ...localizationSettings, enabled: false });
  }, [localizationSettings, setLocalizationSettings]);
  const undoTurnOffLocalization = useCallback(() => {
    if (localizationBeforeOff != null) {
      setLocalizationSettings(localizationBeforeOff);
    }
    setLocalizationBeforeOff(null);
  }, [localizationBeforeOff, setLocalizationSettings]);
  const localizationModel = lenses.models.localization;
  const setLocalizationEnabled = useCallback(
    (enabled: boolean) => {
      setLocalizationBeforeOff(null);
      setLocalizationSettings({ ...localizationSettings, enabled });
    },
    [localizationSettings, setLocalizationSettings]
  );
  const effectLens = repoLenses.get('effect').enabled;
  const setEffectLens = useCallback(
    (enabled: boolean) => setRepoLens('effect', { enabled }),
    [setRepoLens]
  );
  const headerLenses = useMemo(
    () => [
      {
        id: 'localization',
        label: LENSES.localization.label,
        enabled: localizationSettings.enabled,
        onEnabledChange: setLocalizationEnabled,
        onOpenSettings: openLocalization,
      },
      // No gear: the lens reads the code and has nothing to be told.
      {
        id: 'effect',
        label: LENSES.effect.label,
        enabled: effectLens,
        onEnabledChange: setEffectLens,
      },
    ],
    [
      effectLens,
      localizationSettings.enabled,
      openLocalization,
      setEffectLens,
      setLocalizationEnabled,
    ]
  );
  const renderLensHeader = useCallback(
    () => (
      <LocalizationPanel
        model={localizationModel}
        rawShown={lensFilesShown}
        settings={localizationSettings}
        onJumpToLine={handleLensJump}
        onOpenSettings={openLocalization}
        onRawShownChange={setLensFilesShown}
        onSettingsChange={setLocalizationSettings}
        onTurnOff={turnOffLocalization}
      />
    ),
    [
      handleLensJump,
      lensFilesShown,
      localizationModel,
      localizationSettings,
      openLocalization,
      setLocalizationSettings,
      turnOffLocalization,
    ]
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

  // The target as the JSONL export names it — `github.com:owner/repo#123`,
  // the GitLab host in github.com's place — which only a pull target has.
  const stagedTarget = useMemo(
    () => {
      if (target.kind === 'github-pull') {
        return `${GITHUB_HOSTS[0]}:${target.owner}/${target.repo}#${target.number}`;
      }
      if (target.kind === 'gitlab-mr') {
        return `${target.host}:${target.project}#${target.number}`;
      }
      return undefined;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetKey]
  );

  // The repository the watch-list offer names, as one object per target: the
  // dialog's effect holds it in its dependencies, and an inline literal would
  // re-run that effect on every render of this screen. A local diff has none.
  const watchOfferSubject = useMemo<WatchedRepo | undefined>(
    () =>
      forgeTarget == null
        ? undefined
        : isGitLabTarget(forgeTarget)
          ? {
              forge: 'gitlab',
              host: forgeTarget.host,
              project: forgeTarget.project,
            }
          : { owner: forgeTarget.owner, repo: forgeTarget.repo },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetKey]
  );

  // The open merge-request thread, read live rather than remembered: it gains
  // replies, pending marks and failures while it is open, and a navigation
  // replaces it — a snapshot would hide all three and outlive its merge
  // request.
  const mergeRequestMetadata =
    mergeRequestThread == null
      ? undefined
      : comments.annotationsByItemId
          .get(MERGE_REQUEST_ITEM_ID)
          ?.find((item) => item.metadata.key === mergeRequestThread.key)
          ?.metadata;

  // A failed comment-store read, for the strip along the foot of the screen.
  // The submit dialog gates on the same failure.
  const readError =
    comments.readiness.kind === 'failed' ? comments.readiness.error : undefined;

  return (
    <>
      <ReviewHeader
        codeFont={codeFont}
        colorMode={colorMode}
        controls={controls}
        // The header hides this control on every wider screen by CSS, where
        // the file list is a column of its own. Before the diff there is no
        // list to show, so the control is drawn disabled until there is.
        filesOpen={isPhone && filesOpen}
        onToggleFiles={
          diffReady ? () => setFilesOpen((open) => !open) : undefined
        }
        onControlsChange={setControls}
        lenses={headerLenses}
        pull={pullRef == null ? undefined : pull}
        // PullRail renders nothing while the watch list is empty, and the bar's
        // own name is the way home. The header takes that job over when the bar
        // is away, so a review always has a route out of itself.
        showBrand={watched.hydrated && watched.repos.length === 0}
        review={capabilities.commentStore === 'forge' ? review : undefined}
        stack={stack}
        staged={
          capabilities.commentStore === 'forge'
            ? comments.stagedThreads
            : undefined
        }
        stagedCount={comments.stagedThreads.length}
        stagedTarget={stagedTarget}
        target={target}
        commentsError={readError}
        commentsReady={comments.readiness.kind === 'ready'}
        onRetryComments={comments.reload}
        writesPending={comments.writesPending}
        onReviewSubmitted={onReviewSubmitted}
        // A verdict changes the review half of the square the left bar draws on
        // every row, so the list it came from is asked again. The drafts are
        // published by then, so the forge's own lists are asked again too —
        // the comments to show them as posted, the drafts to come back empty.
        // Every attempt reconciles, the failures included: a submit can fail
        // after the forge recorded it.
        onReviewSettled={() => {
          comments.reload();
          openPulls.reload();
        }}
        // One press takes a new snapshot of both halves of the header: the
        // patch, and the pull request's title and state beside it. A local
        // diff is the command's to serve, and has no forge to ask again.
        onRefreshDiff={
          forgeTarget == null
            ? undefined
            : () => {
                patch.retry();
                pull.reload();
              }
        }
        refreshDisabled={
          patch.state === 'fetching' || patch.state === 'parsing'
        }
        reviewViewerLogin={commentViewer?.login}
        session={session}
        untracked={
          untrackedCount === 0
            ? undefined
            : {
                count: untrackedCount,
                shown: !filter.hideUntracked,
                onShownChange: (shown) =>
                  setFilter((state) => ({ ...state, hideUntracked: !shown })),
              }
        }
      />

      {diffReady ? (
        // The tracks are classes, not a style, so the stylesheet's media
        // queries pick the template: one column on a phone (the file list is
        // an overlay there), a sidebar column on a landscape screen, a sidebar
        // band on a portrait one. The widths and the height themselves stay
        // custom properties on this element, because a drag writes them
        // straight here and never re-renders the diff. See
        // hooks/useSidebarWidth.ts and hooks/useSidebarHeight.ts.
        <div
          ref={attachLayout}
          className={cn(
            'bg-canvas relative grid min-h-0 flex-1 overflow-hidden',
            'grid-cols-[minmax(0,1fr)]',
            'phone:landscape:grid-cols-[var(--ghdiff-sidebar-width)_minmax(0,1fr)]',
            'phone:portrait:grid-cols-none phone:portrait:grid-rows-[var(--ghdiff-sidebar-height)_minmax(0,1fr)]'
          )}
          style={{
            ...sidebarWidthStyle,
            ...sidebarHeightStyle,
            direction: 'ltr',
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
            conversation={listedConversation}
            conversationAttachments={conversation.attachments}
            onConversationAttachmentError={conversation.renewAttachments}
            entries={patch.data.entries}
            filter={filter}
            forge={forge}
            hiddenCount={filtered.hiddenCount}
            onAuthorFilterChange={setAuthorMode}
            onCopyPrompt={commentSections.length === 0 ? undefined : copyPrompt}
            onFilterChange={setFilter}
            onSelectComment={handleSelectComment}
            onSelectItem={handleSelectItem}
            stats={filtered.stats}
            totalFileCount={patch.data.stats.fileCount}
            treeSource={filtered.treeSource}
            treeStats={treeStats}
          />
          {/* Both seams stay mounted, and the stylesheet decides which one the
              current layout shows: the width seam on a landscape screen, the
              height seam on a portrait one, neither on a phone — the two panes
              are not side by side there and there is nothing to drag. Hidden,
              not unmounted, the same rule the panes themselves follow. */}
          <PaneResizeHandle
            className="max-phone:hidden portrait:hidden"
            label={m.review_screen_sidebar_width()}
            max={SIDEBAR_MAX_WIDTH}
            min={SIDEBAR_MIN_WIDTH}
            onKeyDown={onSidebarHandleKeyDown}
            onPointerDown={onSidebarHandlePointerDown}
            onReset={resetSidebarWidth}
            style={{ left: `calc(var(${SIDEBAR_WIDTH_PROPERTY}) - 4px)` }}
            width={sidebarWidth}
          />
          <PaneResizeHandle
            className="max-phone:hidden landscape:hidden"
            label={m.review_screen_sidebar_height()}
            max={SIDEBAR_MAX_HEIGHT}
            min={SIDEBAR_MIN_HEIGHT}
            onKeyDown={onBandHandleKeyDown}
            onPointerDown={onBandHandlePointerDown}
            onReset={resetSidebarHeight}
            orientation="horizontal"
            style={{ top: `calc(var(${SIDEBAR_HEIGHT_PROPERTY}) - 4px)` }}
            width={sidebarHeight}
          />
          {/* The diff's column: the search bar, when it is open, and the diff
              under it. The bar takes its row from the diff rather than float
              over it, so nothing in the sticky header is covered while a
              reviewer searches. See DiffSearchBar. */}
          <div className="flex min-h-0 min-w-0 flex-col">
            {search.open && <DiffSearchBar search={search} />}
            {/* The thread cards read their attachments from here, and a
                renewal changes this map alone: no item takes a new version. */}
            <AttachmentsProvider
              attachments={comments.attachments}
              onAttachmentError={comments.renewAttachments}
            >
              <ReviewViewer
                canCreateIssue={comments.canCreateIssue}
                canStage={
                  capabilities.commentStore === 'forge' && commentViewer != null
                }
                commentStore={comments.store}
                controls={controls}
                draftsExist={comments.stagedThreads.length > 0}
                effectLens={effectLens}
                forge={forge}
                items={items}
                loadDiffFiles={files.loadDiffFiles}
                loadingFiles={files.loadingFiles}
                onCancelDraft={comments.removeComment}
                onCreateDraft={handleCreateDraft}
                onDeleteComment={comments.removeComment}
                onReplyToThread={comments.replyToThread}
                onResolveThread={comments.resolveThread}
                onSaveDraft={comments.saveDraft}
                onStageDraft={comments.stageDraft}
                onScroll={onDiffScroll}
                onSelectedLinesChange={handleSelectedLinesChange}
                onToggleCollapsed={setCollapsed}
                onToggleViewed={handleToggleViewed}
                renderHeader={renderLensHeader}
                scrollRef={scrollRef}
                searchMarks={search.marks}
                selectedLines={selectedLines}
                stageNeedsSignIn={
                  capabilities.commentStore === 'forge' && commentViewer == null
                }
                collapsedItemIds={collapsedItemIds}
                themeType={colorMode.hydrated ? colorMode.mode : 'system'}
                viewedItemIds={viewedFiles.viewed}
                viewerRef={viewerRef}
              />
            </AttachmentsProvider>
          </div>
        </div>
      ) : (
        <ReviewStatusPanel
          // Only while the patch is still coming down. The parse and the
          // highlighters are not measured in bytes, and a figure that stayed on
          // screen through them would read as a download that had stalled.
          bytes={patch.state === 'fetching' ? patch.bytes : undefined}
          error={patch.error}
          failure={patch.failure}
          onRetry={patch.retry}
          state={patch.state === 'ready' ? 'starting' : patch.state}
          status={patch.status}
          target={target}
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
      {readError != null && readError !== dismissedError && (
        <ReviewNotice
          onDismiss={() => setDismissedError(readError)}
          tone="error"
        >
          {readError}
        </ReviewNotice>
      )}
      {comments.writeError != null &&
        comments.writeError !== dismissedError && (
          <ReviewNotice
            onDismiss={() => setDismissedError(comments.writeError)}
            tone="error"
          >
            {comments.writeError}
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

      {/* Only while the lens is still off: a switch thrown back from the
          display menu makes the undo, and the message, untrue. */}
      {localizationBeforeOff != null && !localizationSettings.enabled && (
        <Toast
          action={{ label: m.lens_undo(), onPress: undoTurnOffLocalization }}
          onDismiss={() => setLocalizationBeforeOff(null)}
        >
          {m.lens_disabled({ name: LENSES.localization.label })}
        </Toast>
      )}

      {approvalToast != null && (
        <Toast onDismiss={() => setApprovalToast(null)}>
          {describeApproval(approvalToast)}
        </Toast>
      )}

      <LocalizationSettingsDialog
        open={localizationOpen}
        paths={patchPaths}
        repoLabel={repoLabel}
        settings={localizationSettings}
        onClose={() => setLocalizationOpen(false)}
        onSave={setLocalizationSettings}
      />

      {/* The offer of a watch list, for a reviewer who has none. It asks
          nothing until the diff is up: a modal over `ReviewStatusPanel` would
          be a question stacked on a failure. See WatchOfferDialog. */}
      {watchOfferSubject != null && (
        <WatchOfferDialog
          ready={patch.state === 'ready'}
          subject={watchOfferSubject}
        />
      )}

      {/* A thread on the merge request itself, read over its own row: the
          diff holds no annotation for it, so the thread opens here instead. */}
      {mergeRequestThread != null && mergeRequestMetadata != null && (
        <CommentExpansion
          anchor={mergeRequestThread.anchor}
          measureKey={mergeRequestMetadata.comments?.length}
          onClose={() => setMergeRequestThread(null)}
        >
          <ExpandedThread
            forge={forge}
            itemId={MERGE_REQUEST_ITEM_ID}
            metadata={mergeRequestMetadata}
            onClose={() => setMergeRequestThread(null)}
            onDelete={comments.removeComment}
            onReply={comments.replyToThread}
            onResolveThread={comments.resolveThread}
            store={comments.store}
          />
        </CommentExpansion>
      )}
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
          aria-label={m.review_screen_dismiss()}
          size="icon-sm"
          title={m.review_screen_dismiss()}
          variant="quiet"
          onClick={onDismiss}
        >
          <IconXSquircle size={13} />
        </Button>
      )}
    </div>
  );
}
