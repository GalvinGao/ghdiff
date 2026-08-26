import { type PaneWidthState, usePaneWidth } from './usePaneWidth';
import { SIDEBAR_MIN_WIDTH, VIEWER_MIN_WIDTH } from './useSidebarWidth';
import { RAIL_WIDTH_STORAGE_KEY } from '@/lib/storageKeys';

// The left bar's own width. The drag itself is `usePaneWidth`.
//
// A pull request title is as long as its author made it, and one repository's
// branch names are twice the length of another's, so the width that reads well
// is the reviewer's to pick. The bar is the element the drag resizes, so the
// room it has to grow into is its parent's width, not its own.
//
// What it must leave behind is the review screen's two smallest parts: the
// sidebar's minimum and the diff's. The bar can take the rest of a wide window
// and none of a narrow one, and a window that cannot afford the chosen width
// squeezes the bar without forgetting the choice.

export const RAIL_MIN_WIDTH = 200;
export const RAIL_MAX_WIDTH = 480;
/** 17rem, the one width the bar had before it could be dragged. */
export const RAIL_DEFAULT_WIDTH = 272;

export const RAIL_WIDTH_PROPERTY = '--ghdiff-rail-width';

const RAIL_PANE = {
  defaultWidth: RAIL_DEFAULT_WIDTH,
  maxWidth: RAIL_MAX_WIDTH,
  minWidth: RAIL_MIN_WIDTH,
  property: RAIL_WIDTH_PROPERTY,
  reserve: SIDEBAR_MIN_WIDTH + VIEWER_MIN_WIDTH,
  room: 'parent',
  storageKey: RAIL_WIDTH_STORAGE_KEY,
} as const;

export function useRailWidth(): PaneWidthState {
  return usePaneWidth(RAIL_PANE);
}
