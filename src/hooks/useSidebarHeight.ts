import { sidebarHeightPreference } from './preferences';
import { type PaneWidthState, usePaneWidth } from './usePaneWidth';

// The review sidebar's height on a portrait screen, where it is a band above
// the diff instead of a column beside it. The drag itself is `usePaneWidth`,
// turned to the vertical axis.
//
// The room available is the height of the element the sidebar shares with the
// diff — the same element its width is measured against on a landscape screen.
// A height of its own, stored apart from the width, so turning the monitor
// back gives the desktop sidebar its width untouched.

export const SIDEBAR_MIN_HEIGHT = 144;
export const SIDEBAR_MAX_HEIGHT = 560;
export const SIDEBAR_DEFAULT_HEIGHT = 288;
/** The diff is the point of the page, so it keeps at least this much. */
export const VIEWER_MIN_HEIGHT = 320;

export const SIDEBAR_HEIGHT_PROPERTY = '--ghdiff-sidebar-height';

const SIDEBAR_BAND = {
  defaultWidth: SIDEBAR_DEFAULT_HEIGHT,
  maxWidth: SIDEBAR_MAX_HEIGHT,
  minWidth: SIDEBAR_MIN_HEIGHT,
  preference: sidebarHeightPreference,
  property: SIDEBAR_HEIGHT_PROPERTY,
  reserve: VIEWER_MIN_HEIGHT,
  room: 'self',
  axis: 'y',
} as const;

export function useSidebarHeight(): PaneWidthState {
  return usePaneWidth(SIDEBAR_BAND);
}
