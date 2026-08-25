import { useStableCallback } from '@pierre/diffs/react';
import { useEffect, useRef, useState } from 'react';

/**
 * Which file the diff is scrolled to.
 *
 * The reviewer scrolls the diff, and the file list has to say where they are.
 * The viewer reports its scroll offset and can give the top of any item, so the
 * file being read is the last one whose top has passed the anchor line.
 */

/** As much as a sticky file header, so the file whose header is stuck wins. */
const ANCHOR_OFFSET = 16;

/** The one method this hook needs from the viewer. */
interface ItemTopReader {
  getTopForItem(id: string): number | undefined;
}

export interface ActiveDiffItemState {
  activeItemId: string | undefined;
  onScroll(scrollTop: number, viewer: ItemTopReader): void;
}

export function useActiveDiffItem(
  itemIds: readonly string[]
): ActiveDiffItemState {
  const [activeItemId, setActiveItemId] = useState<string | undefined>(
    undefined
  );
  const frameRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    },
    []
  );

  // Before the first scroll the reviewer is at the top of the first file. A
  // filter can also take the current file away, and then the same is true.
  useEffect(() => {
    setActiveItemId((current) =>
      current != null && itemIds.includes(current) ? current : itemIds[0]
    );
  }, [itemIds]);

  // The viewer re-subscribes with whatever callback it is handed, so this one
  // keeps its identity and reads the current item list from the render it
  // belongs to.
  const onScroll = useStableCallback(
    (scrollTop: number, viewer: ItemTopReader) => {
      // One measurement per frame. A scroll fires far more often than that, and
      // the answer can only change once per painted frame anyway.
      if (frameRef.current != null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const anchor = scrollTop + ANCHOR_OFFSET;
        let found: string | undefined = undefined;
        // Items are laid out in patch order, so the tops only grow: the last
        // one at or above the anchor is the file on screen.
        for (const id of itemIds) {
          const top = viewer.getTopForItem(id);
          if (top == null) continue;
          if (top > anchor) break;
          found = id;
        }
        if (found == null) return;
        setActiveItemId((current) => (current === found ? current : found));
      });
    }
  );

  return { activeItemId, onScroll };
}
