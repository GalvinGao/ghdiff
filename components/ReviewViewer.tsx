'use client';

import {
  areSelectionsEqual,
  type CodeViewDiffItem,
  type CodeViewLineSelection,
  type CodeViewOptions,
  type DiffIndicators,
  type DiffLineAnnotation,
  type SelectedLineRange,
  type ThemeTypes,
} from '@pierre/diffs';
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react';
import { memo, type RefObject, useMemo } from 'react';

import { CommentComposer } from '@/components/CommentComposer';
import { CommentThreadCard } from '@/components/CommentThreadCard';
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
  controls: ViewerControls;
  items: readonly CodeViewDiffItem<CommentMetadata>[];
  onCancelDraft(itemId: string, key: string): void;
  onCreateDraft(itemId: string, range: SelectedLineRange): void;
  onDeleteComment(itemId: string, key: string): void;
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
  controls,
  items,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onSaveDraft,
  onScroll,
  onSelectedLinesChange,
  scrollRef,
  selectedLines,
  themeType,
  viewerRef,
}: ReviewViewerProps) {
  const options: CodeViewOptions<CommentMetadata> = useMemo(
    () => ({
      themeType,
      diffStyle: controls.diffStyle,
      diffIndicators: controls.diffIndicators,
      overflow: controls.overflow,
      disableLineNumbers: !controls.lineNumbers,
      disableBackground: !controls.backgrounds,
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
          />
        );
      }}
    />
  );
});

/** Kept next to the viewer so both use the same equality rule. */
export function isSameSelection(
  a: CodeViewLineSelection | null,
  b: CodeViewLineSelection | null
): boolean {
  if (a == null || b == null) return a === b;
  return a.id === b.id && areSelectionsEqual(a.range, b.range);
}
