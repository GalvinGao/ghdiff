import { useStableCallback } from '@pierre/diffs/react';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  indexMatchesByLine,
  isSameMatch,
  nearestMatchIndex,
  type SearchableItem,
  type SearchMarks,
  type SearchMatch,
  searchDiff,
} from '@/lib/diffSearch';
import type { DiffStyle } from '@/lib/viewerControls';

// Find in diff: the state behind the bar.
//
// Cmd+F is taken over on the review screen, because what the browser's own
// find can reach is the rendered window and a reviewer who presses it means the
// whole diff. `src/lib/diffSearch.ts` answers for the whole diff; this hook
// holds the query, the match the reviewer is on, and the three ways of moving
// between matches, and it asks the screen to scroll through `onJump`.
//
// The search runs over the deferred query, so a keystroke into a large diff
// never waits on the walk before it is drawn. A change of query jumps to the
// nearest match, the way the browser's find does as you type. A change of diff
// under the same query — a filter moved, the view changed, a new patch arrived
// — keeps the match the reviewer was on if it is still there and jumps nowhere,
// so folding a file or narrowing the tree does not yank the diff. That is why
// the match is held as a match and not as an index: an index into a list since
// replaced would name the wrong place, where the match can be found again.

export interface DiffSearchState {
  open: boolean;
  query: string;
  /** For the query last searched, which lags the field by a render. */
  matches: readonly SearchMatch[];
  truncated: boolean;
  /** Index into `matches`, or -1 for none. */
  current: number;
  /** What the viewer marks its rows with. Null while the bar is closed. */
  marks: SearchMarks | null;
  /** For the field's `ref`. It focuses the field the moment it is mounted. */
  attachInput(node: HTMLInputElement | null): void;
  setQuery(query: string): void;
  next(): void;
  previous(): void;
  close(): void;
}

let applePlatform: boolean | undefined;

function isApplePlatform(): boolean {
  if (applePlatform != null) return applePlatform;
  const data = (navigator as { userAgentData?: { platform?: string } })
    .userAgentData;
  applePlatform =
    data?.platform != null
      ? data.platform === 'macOS'
      : /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  return applePlatform;
}

/**
 * The platform's own find shortcut, and only that one. On a Mac, Ctrl+F in a
 * text field moves the caret forward, so Cmd is the modifier there and Ctrl
 * everywhere else.
 */
function isFindShortcut(event: KeyboardEvent): boolean {
  if (event.altKey || event.shiftKey) return false;
  if (event.key !== 'f' && event.key !== 'F') return false;
  return isApplePlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

/** Find next, and with Shift, find previous: F3 anywhere, Cmd+G on a Mac. */
function isFindAgainShortcut(event: KeyboardEvent): boolean {
  if (event.altKey) return false;
  if (event.key === 'F3') return !event.metaKey && !event.ctrlKey;
  if (event.key !== 'g' && event.key !== 'G') return false;
  return isApplePlatform() && event.metaKey && !event.ctrlKey;
}

export function useDiffSearch(options: {
  /** The files on screen. A match in a hidden file cannot be scrolled to. */
  items: readonly SearchableItem[];
  /** How the viewer draws them, which is how many places a context line is. */
  diffStyle: DiffStyle;
  /** False until the diff is on screen. The shortcut does nothing before. */
  ready: boolean;
  /** The file the reviewer is reading, where a fresh search starts. */
  activeItemId: string | undefined;
  /** Puts the match on screen. */
  onJump(match: SearchMatch): void;
  /**
   * Called as the bar opens or is focused again, before the field takes
   * focus. On a phone the file list sits over the column the bar is in, and
   * this is where the screen takes it away.
   */
  onShow(): void;
}): DiffSearchState {
  const { items, diffStyle, ready, activeItemId } = options;
  const jump = useStableCallback(options.onJump);
  const reveal = useStableCallback(options.onShow);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState<SearchMatch | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastQueryRef = useRef('');
  // Read by the effect that picks a match, which must not re-run for a scroll:
  // the file on screen changes on every wheel notch, and the match should not.
  const activeItemRef = useRef(activeItemId);
  useEffect(() => {
    activeItemRef.current = activeItemId;
  }, [activeItemId]);

  // A closed bar searches for nothing, which is what takes the marks off the
  // rows without a second flag.
  const deferredQuery = useDeferredValue(open ? query : '');
  const result = useMemo(
    () => searchDiff(items, deferredQuery, { diffStyle }),
    [diffStyle, items, deferredQuery]
  );
  // -1 for a match the list no longer holds, which is the one thing the
  // effect below has to answer.
  const currentIndex = useMemo(
    () =>
      current == null
        ? -1
        : result.matches.findIndex((match) => isSameMatch(match, current)),
    [current, result]
  );

  useEffect(() => {
    const queryChanged = lastQueryRef.current !== deferredQuery;
    lastQueryRef.current = deferredQuery;
    if (!queryChanged && currentIndex !== -1) return;
    const { matches } = result;
    const index = nearestMatchIndex(matches, items, activeItemRef.current);
    const match = index === -1 ? undefined : matches[index];
    setCurrent(match);
    // Only a new query moves the diff. See the note at the top.
    if (queryChanged && match != null) jump(match);
  }, [currentIndex, deferredQuery, items, jump, result]);

  const step = (direction: 1 | -1) => {
    const { matches } = result;
    const count = matches.length;
    if (count === 0) return;
    const from =
      currentIndex === -1 ? (direction === 1 ? -1 : 0) : currentIndex;
    const match = matches[(from + direction + count) % count];
    setCurrent(match);
    jump(match);
  };

  // A field opened to be typed in is focused the moment it is in the document.
  // A press while the bar is already open puts the caret back and selects the
  // query, so the next keystroke replaces it.
  const attachInput = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (node != null) {
      node.focus();
      node.select();
    }
  }, []);
  const show = () => {
    reveal();
    const input = inputRef.current;
    if (input == null) {
      setOpen(true);
      return;
    }
    input.focus();
    input.select();
  };

  // The shortcut is the document's, so it lands whatever has focus: the diff,
  // the tree, a comment being written. Capture, because the viewer stops some
  // key events on their way up. One listener for the life of the diff, reading
  // the state of the render it fires in.
  const onKeyDown = useStableCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    // A modal makes the rest of the document inert, this bar's field with it,
    // so the browser's own find is the right one while a dialog is open: it
    // is the one that reads the dialog, and this one could not take focus.
    if (document.querySelector('dialog[open]') != null) return;
    if (isFindShortcut(event)) {
      event.preventDefault();
      show();
      return;
    }
    if (!open) return;
    if (isFindAgainShortcut(event)) {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    }
  });
  useEffect(() => {
    if (!ready) return undefined;
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () =>
      window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [onKeyDown, ready]);

  const index = useMemo(() => indexMatchesByLine(result.matches), [result]);
  const marks = useMemo<SearchMarks | null>(
    () => (open && index.size > 0 ? { index, current: currentIndex } : null),
    [currentIndex, index, open]
  );

  return {
    open,
    query,
    matches: result.matches,
    truncated: result.truncated,
    current: currentIndex,
    marks,
    attachInput,
    setQuery,
    next: () => step(1),
    previous: () => step(-1),
    close: () => setOpen(false),
  };
}
