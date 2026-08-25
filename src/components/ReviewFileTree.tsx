import { useStableCallback } from '@pierre/diffs/react';
import pierreDark from '@pierre/theme/pierre-dark';
import pierreLight from '@pierre/theme/pierre-light';
import {
  type FileTree as FileTreeModel,
  type FileTreeOptions,
  type FileTreeRowDecoration,
  type FileTreeRowDecorationContext,
  themeToTreeStyles,
} from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';
import {
  type CSSProperties,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { ColorScheme } from '@/hooks/useColorMode';
import type { ReviewTreeSource } from '@/lib/reviewFilter';
import type { TreeStatIndex } from '@/lib/treeStats';

const ITEM_HEIGHT = 24;

// Drop the folder dot: every file in this tree changed, so the dot says
// nothing.
//
// The rest of this stylesheet is the diff-stat lane. Two columns, each as wide
// as the widest number in this diff and each right-aligned, so every `+` figure
// in the tree ends on one pixel and every `-` figure on another. The eye then
// reads a column of numbers instead of hunting for where each row's number
// starts. `flex: 1 0 auto` is what holds that: the lane grows into the space a
// short filename leaves, and never shrinks, so a long filename truncates and
// the numbers stay whole.
const TREE_CSS = `
  [data-item-contains-git-change='true'] > [data-item-section='git'] {
    display: none;
  }
  [data-item-type='folder'] {
    font-weight: 500;
  }
  [data-item-section='decoration'] {
    flex: 1 0 auto;
    padding-left: 10px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  [data-item-section='decoration'] > span {
    gap: 5px;
    max-width: none;
  }
  [data-item-section='decoration'] > span > span {
    display: inline-block;
    text-align: right;
  }
  [data-item-section='decoration'] > span > span:first-child {
    width: var(--ghdiff-tree-add-column, 3ch);
  }
  [data-item-section='decoration'] > span > span:last-child {
    width: var(--ghdiff-tree-delete-column, 3ch);
  }
  /* A directory total is a summary of the rows under it, so it sits behind
     them rather than competing with them. */
  [data-item-type='folder'] [data-item-section='decoration'] {
    opacity: 0.55;
  }
`;

// The patch order is the review order, so the tree must not re-sort.
const PRESERVE_PATCH_ORDER: Exclude<
  NonNullable<FileTreeOptions['sort']>,
  'default'
> = () => 0;

const BASE_OPTIONS = {
  flattenEmptyDirectories: true,
  id: 'ghdiff-file-tree',
  initialExpansion: 'open',
  presorted: true,
  // The sidebar's own field owns the search: it writes the filter's path
  // query, which takes a file out of the diff as well as out of the tree. The
  // tree's box only narrowed the tree, and it rendered inside the scroll
  // region, below the sidebar's own controls.
  search: false,
  stickyFolders: true,
  unsafeCSS: TREE_CSS,
} as const satisfies Omit<FileTreeOptions, 'paths' | 'preparedInput'>;

// The theme's own selection colour is a near-invisible wash of the sidebar in
// dark mode, so the row under the reviewer's attention is painted with the
// app's accent instead. The rest of the overrides are layout only.
const STYLE_OVERRIDES: CSSProperties = {
  '--trees-density-override': 0.85,
  '--trees-padding-inline-override': 8,
  '--trees-selected-bg-override': 'var(--app-tree-selected)',
  '--trees-selected-fg-override': 'var(--app-ink)',
} as CSSProperties;

interface ReviewFileTreeProps {
  /**
   * The item the diff is scrolled to. The tree selects and reveals it, so the
   * file list always says where the reviewer is.
   */
  activeItemId?: string;
  colorScheme: ColorScheme;
  /** For a caller that has to drive the tree itself. Nothing does today. */
  onModelReady?(model: FileTreeModel | null): void;
  onSelectPath(itemId: string): void;
  source: ReviewTreeSource;
  /** Added and deleted lines per row, files and directories alike. */
  stats: TreeStatIndex;
}

export const ReviewFileTree = memo(function ReviewFileTree({
  activeItemId,
  colorScheme,
  onModelReady,
  onSelectPath,
  source,
  stats,
}: ReviewFileTreeProps) {
  // useFileTree reads its options once, through a state initializer, so the
  // first path list must be captured the same way, and the selection callback
  // must stay stable while it still reads the current source.
  const [initialPaths] = useState(() => source.paths);
  const [initialGitStatus] = useState(() => source.gitStatus);
  // The path the tree currently shows as selected, and the one selection this
  // component asked for itself. A selection it asked for must not travel back
  // out as if the reviewer had clicked the row.
  const selectedPathRef = useRef<string | null>(null);
  const appliedPathRef = useRef<string | null>(null);

  const handleSelectionChange = useStableCallback(
    (selectedPaths: readonly string[]) => {
      if (selectedPaths.length !== 1) return;
      const path = selectedPaths[0];
      selectedPathRef.current = path;
      // The selection this component just made, coming back. Scrolling the diff
      // must not be read as a click on the row it lit up, or the diff would be
      // told to scroll to where it already is. The path is not cleared here: a
      // click on a row that is already selected raises no event at all, so
      // there is nothing this can swallow.
      if (path === appliedPathRef.current) return;
      const itemId = source.itemIdByPath.get(path);
      if (itemId != null) onSelectPath(itemId);
    }
  );

  // The tree reads its options once, so this keeps its identity for the life of
  // the model and reads the current stats from the render it belongs to. It runs
  // once per visible row per paint, which is why it does no work beyond a map
  // lookup: the sums were taken in one pass when the diff was parsed.
  const renderRowDecoration = useStableCallback(
    ({ item }: FileTreeRowDecorationContext): FileTreeRowDecoration | null => {
      const stat = stats.byPath.get(item.path);
      if (stat == null) return null;
      const added = `+${String(stat.addedLines)}`;
      const deleted = `-${String(stat.deletedLines)}`;
      return {
        // `text` is the plain form the decoration type requires. `parts` is
        // what the tree draws, one span per number, so each keeps its own
        // colour and its own column.
        text: `${added} ${deleted}`,
        parts: [
          { text: added, color: 'var(--app-added)' },
          { text: deleted, color: 'var(--app-removed)' },
        ],
        // A directory says how many files it counts, which is the one thing the
        // row does not already show. A file's own numbers need no title.
        title:
          item.kind === 'directory'
            ? `${String(stat.fileCount)} ${
                stat.fileCount === 1 ? 'file' : 'files'
              }, ${added} ${deleted}`
            : undefined,
      };
    }
  );

  const { model } = useFileTree({
    ...BASE_OPTIONS,
    paths: initialPaths,
    gitStatus: initialGitStatus,
    sort: PRESERVE_PATCH_ORDER,
    itemHeight: ITEM_HEIGHT,
    onSelectionChange: handleSelectionChange,
    renderRowDecoration,
  });

  const pathByItemId = useMemo(() => {
    const result = new Map<string, string>();
    for (const [path, itemId] of source.itemIdByPath) result.set(itemId, path);
    return result;
  }, [source]);

  // A filter change rewrites the whole path list, so the model resets. The list
  // is bounded by the diff, not by a stream, so a reset is cheap here. A reset
  // also throws away the selection, so the record of what is selected goes with
  // it and the effect below puts the row back.
  useEffect(() => {
    model.resetPaths(source.paths);
    model.setGitStatus(source.gitStatus);
    selectedPathRef.current = null;
  }, [model, source]);

  // The one place the selection is written. It runs again after every reset,
  // because a new source brings a new path map, so the row for the file on
  // screen survives a filter change instead of being cleared by it.
  useEffect(() => {
    if (activeItemId == null) return;
    const path = pathByItemId.get(activeItemId);
    if (path == null || path === selectedPathRef.current) return;
    appliedPathRef.current = path;
    // The rows that were selected are cleared first. `select()` ADDS to the
    // selection, so scrolling the diff used to leave every file it had passed
    // lit up, and the tree filled with a trail of already-read files. It also
    // stopped the click handler above, which only answers a selection of one.
    for (const selected of model.getSelectedPaths()) {
      if (selected !== path) model.getItem(selected)?.deselect();
    }
    model.getItem(path)?.select();
    model.scrollToPath(path, { offset: 'nearest' });
  }, [activeItemId, model, pathByItemId]);

  useEffect(() => {
    if (onModelReady == null) return undefined;
    onModelReady(model);
    return () => onModelReady(null);
  }, [model, onModelReady]);

  const style = useMemo(
    () =>
      ({
        ...themeToTreeStyles(colorScheme === 'dark' ? pierreDark : pierreLight),
        ...STYLE_OVERRIDES,
        // One extra character for the sign. `ch` is the width of a zero, and
        // the lane sets tabular figures, so every digit measures the same.
        '--ghdiff-tree-add-column': `${String(stats.addedDigits + 1)}ch`,
        '--ghdiff-tree-delete-column': `${String(stats.deletedDigits + 1)}ch`,
      }) as CSSProperties,
    [colorScheme, stats.addedDigits, stats.deletedDigits]
  );

  return (
    <FileTree
      className="h-full min-h-0 overflow-auto overscroll-none"
      model={model}
      style={style}
    />
  );
});
