import {
  areSelectionsEqual,
  type CodeViewDiffItem,
  type CodeViewItem,
  type CodeViewLineSelection,
  type CodeViewOptions,
  type DiffIndicators,
  type DiffLineAnnotation,
  type FileDiffContentsLoader,
  type FileDiffMetadata,
  type SelectedLineRange,
  type ThemeTypes,
} from '@pierre/diffs';
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react';
import { IconExpandRow } from '@pierre/icons';
import { memo, type RefObject, useCallback, useMemo } from 'react';

import { CommentComposer } from '@/components/CommentComposer';
import { CommentThreadCard } from '@/components/CommentThreadCard';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import type { CommentStore } from '@/hooks/useReviewComments';
import { cn } from '@/lib/cn';
import { type CommentMetadata, isDraftComment } from '@/lib/comments';

export interface ViewerControls {
  diffStyle: 'split' | 'unified';
  diffIndicators: DiffIndicators;
  overflow: 'wrap' | 'scroll';
  lineNumbers: boolean;
  backgrounds: boolean;
}

/** The one method the scroll handler needs from the viewer it is handed. */
interface ItemTopReader {
  getTopForItem(id: string): number | undefined;
}

interface ReviewViewerProps {
  className?: string;
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
  scrollRef: RefObject<HTMLDivElement | null>;
  selectedLines: CodeViewLineSelection | null;
  themeType: ThemeTypes;
  viewerRef: RefObject<CodeViewHandle<CommentMetadata> | null>;
}

// The gutter utility is the small button that appears in the line gutter on
// hover. It is what opens a comment composer on the hovered line.
export const ReviewViewer = memo(function ReviewViewer({
  className,
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
  scrollRef,
  selectedLines,
  themeType,
  viewerRef,
}: ReviewViewerProps) {
  // In the file header, beside the name, the way GitHub places the same
  // control. The hunk separators reveal 100 lines per press; this is the one
  // press that asks for the whole file instead.
  const renderHeaderFilenameSuffix = useCallback(
    (item: CodeViewItem<CommentMetadata>) => {
      if (item.type !== 'diff' || !canExpandWholeFile(item.fileDiff)) {
        return null;
      }
      return <ExpandFileButton itemId={item.id} viewerRef={viewerRef} />;
    },
    [viewerRef]
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
              itemId={item.id}
              metadata={diffAnnotation.metadata}
              onCancel={onCancelDraft}
              onSave={onSaveDraft}
            />
          );
        }
        return (
          <CommentThreadCard
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
