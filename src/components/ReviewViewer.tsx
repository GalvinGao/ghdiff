import {
  areSelectionsEqual,
  type CodeViewDiffItem,
  type CodeViewItem,
  type CodeViewLineSelection,
  type CodeViewOptions,
  type DiffLineAnnotation,
  type FileDiffContentsLoader,
  type FileDiffMetadata,
  type SelectedLineRange,
  type ThemeTypes,
} from '@pierre/diffs';
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react';
import { IconChevron, IconExpandRow } from '@pierre/icons';
import { memo, type RefObject, useCallback, useMemo } from 'react';

import { CommentComposer } from '@/components/CommentComposer';
import { CommentThreadCard } from '@/components/CommentThreadCard';
import { applyLineMarks, LINE_MARKS_CSS } from '@/components/diffLineMarks';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import type { CommentStore } from '@/hooks/useReviewComments';
import { cn } from '@/lib/cn';
import { type CommentMetadata, isDraftComment } from '@/lib/comments';
import type { ViewerControls } from '@/lib/viewerControls';

/** The one method the scroll handler needs from the viewer it is handed. */
interface ItemTopReader {
  getTopForItem(id: string): number | undefined;
}

interface ReviewViewerProps {
  className?: string;
  /** The files folded shut, by item id. */
  collapsedItemIds: ReadonlySet<string>;
  /** Where a comment written here goes, which a card says out loud. */
  commentStore: CommentStore;
  controls: ViewerControls;
  items: readonly CodeViewDiffItem<CommentMetadata>[];
  /**
   * Reads a whole file so the viewer can draw the unmodified lines a patch
   * left out. Its presence is also what puts the expand controls on a hunk
   * separator, so it is passed from the first render and not on demand.
   */
  loadDiffFiles: FileDiffContentsLoader;
  onCancelDraft(itemId: string, key: string): void;
  onCreateDraft(itemId: string, range: SelectedLineRange): void;
  onDeleteComment(itemId: string, key: string): void;
  onReplyToThread(itemId: string, key: string, body: string): void;
  onSaveDraft(itemId: string, key: string, body: string): void;
  /** Reports the scroll offset, so the file tree can follow the diff. */
  onScroll(scrollTop: number, viewer: ItemTopReader): void;
  onSelectedLinesChange(selection: CodeViewLineSelection | null): void;
  /** Folds one file shut, or opens it again. */
  onToggleCollapsed(itemId: string, collapsed: boolean): void;
  /** Sets, or takes back, this file's own "I have read this" mark. */
  onToggleViewed(itemId: string, viewed: boolean): void;
  scrollRef: RefObject<HTMLDivElement | null>;
  selectedLines: CodeViewLineSelection | null;
  themeType: ThemeTypes;
  /** The files already marked read, by item id. */
  viewedItemIds: ReadonlySet<string>;
  viewerRef: RefObject<CodeViewHandle<CommentMetadata> | null>;
}

// The gutter utility is the small button that appears in the line gutter on
// hover. It is what opens a comment composer on the hovered line.
export const ReviewViewer = memo(function ReviewViewer({
  className,
  collapsedItemIds,
  commentStore,
  controls,
  items,
  loadDiffFiles,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onReplyToThread,
  onSaveDraft,
  onScroll,
  onSelectedLinesChange,
  onToggleCollapsed,
  onToggleViewed,
  scrollRef,
  selectedLines,
  themeType,
  viewedItemIds,
  viewerRef,
}: ReviewViewerProps) {
  // First in the header, before the change-type icon, where github.com puts
  // its own. This slot is the one thing drawn to the left of that icon.
  const renderHeaderPrefix = useCallback(
    (item: CodeViewItem<CommentMetadata>) => (
      <CollapseFileButton
        collapsed={collapsedItemIds.has(item.id)}
        itemId={item.id}
        onToggle={onToggleCollapsed}
      />
    ),
    [collapsedItemIds, onToggleCollapsed]
  );

  // In the file header, beside the name, the way GitHub places the same
  // control. The hunk separators reveal 100 lines per press; this is the one
  // press that asks for the whole file instead.
  const renderHeaderFilenameSuffix = useCallback(
    (item: CodeViewItem<CommentMetadata>) => {
      // Not on a folded file. There is nothing to reveal into, and the tooltip
      // could not be read there anyway. See `CollapseFileButton`.
      if (
        item.type !== 'diff' ||
        collapsedItemIds.has(item.id) ||
        !canExpandWholeFile(item.fileDiff)
      ) {
        return null;
      }
      return <ExpandFileButton itemId={item.id} viewerRef={viewerRef} />;
    },
    [collapsedItemIds, viewerRef]
  );

  // After the file's own `-N +N`, which is where github.com puts the same
  // control. This slot is the last child of the header's metadata row, so the
  // toggle lands to the right of the two figures and takes the row's own gap.
  const renderHeaderMetadata = useCallback(
    (item: CodeViewItem<CommentMetadata>) => (
      <ViewedToggle
        itemId={item.id}
        onToggle={onToggleViewed}
        viewed={viewedItemIds.has(item.id)}
      />
    ),
    [onToggleViewed, viewedItemIds]
  );

  const options: CodeViewOptions<CommentMetadata> = useMemo(
    () => ({
      themeType,
      diffStyle: controls.diffStyle,
      diffIndicators: controls.diffIndicators,
      overflow: controls.overflow,
      disableLineNumbers: !controls.lineNumbers,
      disableBackground: !controls.backgrounds,
      loadDiffFiles,
      layout: { paddingTop: 0, paddingBottom: 0, gap: 1 },
      lineHoverHighlight: 'number',
      enableLineSelection: true,
      enableGutterUtility: true,
      stickyHeaders: true,
      onGutterUtilityClick(range, context) {
        if (context.item.type !== 'diff') return;
        onCreateDraft(context.item.id, range);
      },
      // The stylesheet for the marks below, installed by the library inside
      // each file's shadow root, where no outside selector can reach.
      unsafeCSS: LINE_MARKS_CSS,
      onPostRender(node, instance, phase) {
        if (phase === 'unmount') return;
        // `fileDiffCache` is protected in the type and a plain getter at
        // runtime; there is no public path from an instance to its metadata.
        const fileDiff = (
          instance as unknown as { fileDiffCache?: FileDiffMetadata }
        ).fileDiffCache;
        applyLineMarks(node, fileDiff);
      },
    }),
    [
      controls.backgrounds,
      controls.diffIndicators,
      controls.diffStyle,
      controls.lineNumbers,
      controls.overflow,
      loadDiffFiles,
      onCreateDraft,
      themeType,
    ]
  );

  return (
    <CodeView<CommentMetadata>
      ref={viewerRef}
      containerRef={scrollRef}
      items={items}
      options={options}
      selectedLines={selectedLines}
      onScroll={onScroll}
      onSelectedLinesChange={onSelectedLinesChange}
      renderHeaderFilenameSuffix={renderHeaderFilenameSuffix}
      renderHeaderMetadata={renderHeaderMetadata}
      renderHeaderPrefix={renderHeaderPrefix}
      className={cn(
        'cv-scrollbar bg-canvas relative h-full min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto',
        // `none`, not `contain`: contain stops the scroll from chaining to the
        // page but still lets this element bounce, and the bounce exposes an
        // unpainted strip at the end of the diff.
        'overscroll-none',
        '[contain:strict] [overflow-anchor:none]',
        className
      )}
      renderAnnotation={(annotation, item) => {
        if (!('side' in annotation) || item.type !== 'diff') return null;
        const diffAnnotation =
          annotation as DiffLineAnnotation<CommentMetadata>;
        if (isDraftComment(diffAnnotation.metadata)) {
          return (
            <CommentComposer
              key={diffAnnotation.metadata.key}
              itemId={item.id}
              metadata={diffAnnotation.metadata}
              onCancel={onCancelDraft}
              onSave={onSaveDraft}
            />
          );
        }
        return (
          <CommentThreadCard
            key={diffAnnotation.metadata.key}
            itemId={item.id}
            metadata={diffAnnotation.metadata}
            onDelete={onDeleteComment}
            onReply={onReplyToThread}
            store={commentStore}
          />
        );
      }}
    />
  );
});

/**
 * Folds one file shut. It sits before the change-type icon, which is the only
 * place on the row that reads as belonging to the whole file rather than to
 * its name, and it is where github.com puts the same chevron.
 *
 * The chevron turns rather than swapping for a second glyph, so the press
 * reads as one control moving and not as two controls trading places. It is
 * the only state a reviewer can reach from two directions. The chevron itself
 * and the Viewed mark beside the figures both set it, so `aria-expanded` says
 * which way it is however it got there.
 *
 * Its box is the hunk separator's expand button, continued up into the header,
 * and that is why it is 32px around a 16px glyph rather than the 28 around 13
 * every other icon button in the app takes. A file with collapsed context
 * draws that button one row below this one, in the same glyph, for the same
 * kind of press — and the two sat six pixels and three pixels of glyph apart,
 * which reads as one column that failed to line up rather than as two
 * controls. `HEADER_PREFIX_PULL` closes the gap: the separator insets its
 * button by the library's own inline gap and the header pads by 16, so the
 * chevron gives back the difference. Both figures are the library's defaults
 * and neither is a variable this app can read, so a change to either has to be
 * answered here.
 *
 * The word comes from the browser's own `title` and not from `Tooltip`, which
 * is the one control in the app that needs it to. Each file is laid out inside
 * a container of its own that the library contains, and containment makes a
 * stacking context, so a label drawn below this button is painted over by the
 * next file whatever its z-index. That is exactly the case this control is
 * for: a folded file is one header tall, and everything under it belongs to
 * the file after it.
 */
function CollapseFileButton({
  collapsed,
  itemId,
  onToggle,
}: {
  collapsed: boolean;
  itemId: string;
  onToggle(itemId: string, collapsed: boolean): void;
}) {
  const label = collapsed ? 'Show the diff' : 'Hide the diff';
  return (
    <Button
      aria-expanded={!collapsed}
      aria-label={label}
      className={HEADER_PREFIX_PULL}
      size="icon"
      title={label}
      variant="quiet"
      onClick={() => onToggle(itemId, !collapsed)}
    >
      <IconChevron
        className={cn(
          'transition-transform duration-150 motion-reduce:transition-none',
          collapsed && '-rotate-90'
        )}
        size={16}
      />
    </Button>
  );
}

/**
 * 16px of header padding, less the 8px the separator insets its own expand
 * button by, so the two land in one column. See `CollapseFileButton`.
 */
const HEADER_PREFIX_PULL = '-ml-2';

/**
 * A quiet button's padding is its hover box and not its text, so the last
 * letter of `Viewed` stopped 8px short of the line the header's own padding
 * draws, and the box before it sat 8px further from `+N` than `+N` sits from
 * `-N`. The button gives both back: the label ends where the figures would
 * have ended, the two gaps in the row become one gap, and the hover box is the
 * only thing that reaches past either.
 */
const HEADER_METADATA_PULL = '-mx-2';

/**
 * Only a changed file has unmodified lines the patch left out: a new or a
 * deleted file arrives whole, and a pure rename has no lines at all. This is
 * the library's own hydration test, minus `rename-pure`.
 */
function canExpandWholeFile(fileDiff: FileDiffMetadata): boolean {
  return fileDiff.type === 'change' || fileDiff.type === 'rename-changed';
}

const EXPAND_WHOLE_FILE_LABEL = 'Show the whole file';

/**
 * The whole file is safe where a single press is: the file was already turned
 * away at `MAX_FILE_BYTES` if it could not be afforded, and the virtualizer
 * lays out only what is on screen. The button stays after the press, because
 * the expansion state lives inside the viewer's rendered instance and React
 * cannot read it — a second press finds every region already at its full size
 * and changes nothing.
 */
function ExpandFileButton({
  itemId,
  viewerRef,
}: {
  itemId: string;
  viewerRef: RefObject<CodeViewHandle<CommentMetadata> | null>;
}) {
  return (
    <Tooltip label={EXPAND_WHOLE_FILE_LABEL}>
      <Button
        aria-label={EXPAND_WHOLE_FILE_LABEL}
        size="icon-sm"
        variant="quiet"
        onClick={() => {
          const viewer = viewerRef.current;
          if (viewer != null) expandWholeFile(viewer, itemId);
        }}
      >
        <IconExpandRow size={13} />
      </Button>
    </Tooltip>
  );
}

/**
 * The file's own "I have read this" mark, in the header where github.com puts
 * it. Where the mark is kept is the hook's business and not this button's: on
 * a pull request it goes to GitHub, and on a commit or a compare range it goes
 * to this browser, because GitHub holds no such mark for either.
 *
 * A toggle button and not an `<input type="checkbox">`, for the reason
 * `TaskMarker` draws its own box: the browser paints a native one in the
 * platform's blue, which is the single colour this app never uses. The word
 * sits beside the box rather than in a tooltip, because a tick with nothing
 * next to it does not say what it is a tick for.
 */
function ViewedToggle({
  itemId,
  onToggle,
  viewed,
}: {
  itemId: string;
  onToggle(itemId: string, viewed: boolean): void;
  viewed: boolean;
}) {
  return (
    <Button
      aria-pressed={viewed}
      className={HEADER_METADATA_PULL}
      onClick={() => onToggle(itemId, !viewed)}
      size="sm"
      variant="quiet"
    >
      <ViewedBox checked={viewed} />
      Viewed
    </Button>
  );
}

/**
 * The box, in the two tones `TaskMarker` already uses for the same shape. The
 * checked state fills with the accent rather than adding a tick to the same
 * empty box: a header row is read at a glance, and a hairline tick at 13px is
 * not a glance.
 */
function ViewedBox({ checked }: { checked: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="shrink-0"
      height={13}
      viewBox="0 0 16 16"
      width={13}
    >
      <rect
        fill={checked ? 'var(--app-accent)' : 'var(--app-surface)'}
        height={13}
        rx={3.5}
        stroke={checked ? 'var(--app-accent)' : 'var(--app-ink-faint)'}
        width={13}
        x={1.5}
        y={1.5}
      />
      {checked && (
        <path
          d="M4.6 8.2 7 10.6l4.4-5"
          fill="none"
          stroke="var(--app-accent-ink)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
        />
      )}
    </svg>
  );
}

/**
 * Asks every collapsed region of one file for everything, through the same
 * call the library's own shift-click sends for one region: `expandHunk` with
 * an infinite count, which the region clamps to its own size. On a file still
 * partial, the first call also starts the one `/api/file` fetch and the
 * expansions wait for it; a fetch that fails leaves the file partial, keeps
 * the regions collapsed, and reports through the strip at the foot of the
 * screen like any other press.
 *
 * The instance is read from the rendered items, which is safe here and only
 * here: the button lives in this file's own header, so the file is rendered
 * whenever the button can be pressed.
 */
function expandWholeFile(
  viewer: CodeViewHandle<CommentMetadata>,
  itemId: string
): void {
  const rendered = viewer
    .getInstance()
    ?.getRenderedItems()
    .find((entry) => entry.id === itemId);
  if (rendered == null || rendered.type !== 'diff') return;
  // Region i is the gap above hunk i, and one more region is the tail of the
  // file, which is why the loop runs one past the hunks.
  const { hunks } = rendered.item.fileDiff;
  for (let region = 0; region <= hunks.length; region++) {
    rendered.instance.expandHunk(region, 'both', Number.POSITIVE_INFINITY);
  }
}

/** Kept next to the viewer so both use the same equality rule. */
export function isSameSelection(
  a: CodeViewLineSelection | null,
  b: CodeViewLineSelection | null
): boolean {
  if (a == null || b == null) return a === b;
  return a.id === b.id && areSelectionsEqual(a.range, b.range);
}
