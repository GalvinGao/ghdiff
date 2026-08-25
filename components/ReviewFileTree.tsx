'use client';

import { useStableCallback } from '@pierre/diffs/react';
import pierreDark from '@pierre/theme/pierre-dark';
import pierreLight from '@pierre/theme/pierre-light';
import {
  type FileTree as FileTreeModel,
  type FileTreeOptions,
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

const ITEM_HEIGHT = 24;

// Hide the tree's own search box until the sidebar toggle opens it, and drop
// the folder dot: every file in this tree changed, so the dot says nothing.
const TREE_CSS = `
  [data-file-tree-search-container][data-open='false'] {
    display: none;
  }
  [data-file-tree-search-container] {
    margin-right: 4px;
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--trees-theme-border, #8883);
  }
  [data-item-contains-git-change='true'] > [data-item-section='git'] {
    display: none;
  }
  [data-item-type='folder'] {
    font-weight: 500;
  }
`;

// The patch order is the review order, so the tree must not re-sort.
const PRESERVE_PATCH_ORDER: Exclude<
  NonNullable<FileTreeOptions['sort']>,
  'default'
> = () => 0;

const BASE_OPTIONS = {
  flattenEmptyDirectories: true,
  id: 'reviewer-file-tree',
  initialExpansion: 'open',
  presorted: true,
  search: true,
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
  onModelReady(model: FileTreeModel | null): void;
  onSelectPath(itemId: string): void;
  source: ReviewTreeSource;
}

export const ReviewFileTree = memo(function ReviewFileTree({
  activeItemId,
  colorScheme,
  onModelReady,
  onSelectPath,
  source,
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

  const { model } = useFileTree({
    ...BASE_OPTIONS,
    paths: initialPaths,
    gitStatus: initialGitStatus,
    sort: PRESERVE_PATCH_ORDER,
    itemHeight: ITEM_HEIGHT,
    onSelectionChange: handleSelectionChange,
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
    onModelReady(model);
    return () => onModelReady(null);
  }, [model, onModelReady]);

  const style = useMemo(
    () => ({
      ...themeToTreeStyles(colorScheme === 'dark' ? pierreDark : pierreLight),
      ...STYLE_OVERRIDES,
    }),
    [colorScheme]
  );

  return (
    <FileTree
      className="h-full min-h-0 overflow-auto overscroll-none"
      model={model}
      style={style}
    />
  );
});
