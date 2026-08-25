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
import { type CSSProperties, memo, useEffect, useMemo, useState } from 'react';

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

const DENSITY: CSSProperties = {
  '--trees-density-override': 0.85,
  '--trees-padding-inline-override': 8,
} as CSSProperties;

interface ReviewFileTreeProps {
  colorScheme: ColorScheme;
  onModelReady(model: FileTreeModel | null): void;
  onSelectPath(itemId: string): void;
  source: ReviewTreeSource;
}

export const ReviewFileTree = memo(function ReviewFileTree({
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
  const handleSelectionChange = useStableCallback(
    (selectedPaths: readonly string[]) => {
      if (selectedPaths.length !== 1) return;
      const itemId = source.itemIdByPath.get(selectedPaths[0]);
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

  // A filter change rewrites the whole path list, so the model resets. The list
  // is bounded by the diff, not by a stream, so a reset is cheap here.
  useEffect(() => {
    model.resetPaths(source.paths);
    model.setGitStatus(source.gitStatus);
  }, [model, source]);

  useEffect(() => {
    onModelReady(model);
    return () => onModelReady(null);
  }, [model, onModelReady]);

  const style = useMemo(
    () => ({
      ...themeToTreeStyles(colorScheme === 'dark' ? pierreDark : pierreLight),
      ...DENSITY,
    }),
    [colorScheme]
  );

  return (
    <FileTree
      className="h-full min-h-0 overflow-auto overscroll-contain"
      model={model}
      style={style}
    />
  );
});
