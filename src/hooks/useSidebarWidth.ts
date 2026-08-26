import { type PaneWidthState, usePaneWidth } from './usePaneWidth';
import { SIDEBAR_WIDTH_STORAGE_KEY } from '@/lib/storageKeys';

// The review sidebar's own width. The drag itself is `usePaneWidth`.
//
// The room available is the width of the element the sidebar shares with the
// diff, not the width of the window. The left bar sits outside that element, so
// the window would over-report the room by the whole width of the bar, and
// collapsing the bar has to hand its space to the sidebar.

export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 720;
export const SIDEBAR_DEFAULT_WIDTH = 304;
/** The diff is the point of the page, so it keeps at least this much. */
export const VIEWER_MIN_WIDTH = 360;

export const SIDEBAR_WIDTH_PROPERTY = '--ghdiff-sidebar-width';

const SIDEBAR_PANE = {
  defaultWidth: SIDEBAR_DEFAULT_WIDTH,
  maxWidth: SIDEBAR_MAX_WIDTH,
  minWidth: SIDEBAR_MIN_WIDTH,
  property: SIDEBAR_WIDTH_PROPERTY,
  reserve: VIEWER_MIN_WIDTH,
  room: 'self',
  storageKey: SIDEBAR_WIDTH_STORAGE_KEY,
} as const;

export function useSidebarWidth(): PaneWidthState {
  return usePaneWidth(SIDEBAR_PANE);
}
