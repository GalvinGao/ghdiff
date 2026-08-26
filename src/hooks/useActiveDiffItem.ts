import { useStableCallback } from '@pierre/diffs/react';
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

/**
 * Which file the diff is scrolled to.
 *
 * The reviewer scrolls the diff, and the file list has to say where they are.
 * The viewer reports its scroll offset and can give the top of any item, so the
 * file being read is the last one whose top has passed the anchor line.
 *
 * A scroll the viewer was told to make raises no such report, so a jump — a row
 * in the tree, a thread in the comment list, a fragment in the URL — names its
 * own file through `select`. Without that the file list would go on marking
 * whichever file the reviewer last scrolled past.
 *
 * A smooth jump does raise those reports, one per frame, for every file it
 * crosses on the way. Each one is a true answer to "what is under the anchor
 * right now" and a wrong answer to "what is the reviewer reading", and the file
 * list ran the whole run of them as a highlight travelling down the tree. So a
 * jump holds the mark on the file it named until the diff gets there. The hold
 * ends three ways: the diff arrives, the reviewer takes the scroll back with a
 * gesture of their own, or the diff stops moving without either.
 */

/** As much as a sticky file header, so the file whose header is stuck wins. */
const ANCHOR_OFFSET = 16;

/**
 * How long a jump waits for the next scroll report before it calls the diff
 * settled. A smooth scroll reports every frame and the longest one the browser
 * runs is under half a second, so this gap cannot fall inside one. It is the
 * backstop for the jump that never arrives: a scroll region that has bottomed
 * out cannot bring the last file's top up to the anchor, and the file the
 * reviewer asked for is still the right answer there.
 */
const JUMP_SETTLE_MS = 200;

/**
 * The gestures that mean the reviewer, and not the jump, is moving the diff.
 * The mark follows the scroll again from the very next report after one of
 * these, rather than waiting out the settle above.
 *
 * They are the four `CodeView` itself binds on the same element to abandon a
 * scroll it is running — a smooth scroll there is the viewer's own spring, not
 * the browser's, and this is the list it drops it on. The two sets have to
 * stay the same list: an event that ends the scroll and not the hold would
 * leave the mark behind, and one that ends the hold and not the scroll would
 * bring the whole run of crossed files back.
 */
const TAKEOVER_EVENTS = [
  'keydown',
  'pointerdown',
  'touchstart',
  'wheel',
] as const;

const TAKEOVER_OPTIONS: AddEventListenerOptions = {
  capture: true,
  passive: true,
};

/** The one method this hook needs from the viewer. */
interface ItemTopReader {
  getTopForItem(id: string): number | undefined;
}

export interface ActiveDiffItemState {
  activeItemId: string | undefined;
  onScroll(scrollTop: number, viewer: ItemTopReader): void;
  /** States the file outright, for a jump the viewer does not report. */
  select(itemId: string): void;
}

export function useActiveDiffItem(
  itemIds: readonly string[],
  /** The diff's own scroll region, where a takeover gesture lands. */
  scrollRef: RefObject<HTMLElement | null>
): ActiveDiffItemState {
  const [activeItemId, setActiveItemId] = useState<string | undefined>(
    undefined
  );
  const frameRef = useRef<number | null>(null);
  // The file a jump named, for as long as the diff is still on its way there.
  // Null the rest of the time, which is every scroll the reviewer makes.
  const jumpTargetRef = useRef<string | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);

  // Gives the scroll back to the reviewer: the next report moves the mark.
  const endJump = useCallback(() => {
    jumpTargetRef.current = null;
    if (settleRef.current != null) {
      clearTimeout(settleRef.current);
      settleRef.current = null;
    }
    releaseRef.current?.();
    releaseRef.current = null;
  }, []);

  // Restarted on every report the jump raises, so the timer measures the gap
  // between reports rather than the length of the scroll.
  const armSettle = useCallback(() => {
    if (settleRef.current != null) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(endJump, JUMP_SETTLE_MS);
  }, [endJump]);

  const beginJump = useCallback(
    (itemId: string) => {
      endJump();
      jumpTargetRef.current = itemId;
      armSettle();
      const element = scrollRef.current;
      if (element == null) return;
      // The listeners live for the length of one jump and no longer. The diff
      // is scrolled far more often than it is jumped, and none of those scrolls
      // has a question for them.
      for (const type of TAKEOVER_EVENTS) {
        element.addEventListener(type, endJump, TAKEOVER_OPTIONS);
      }
      releaseRef.current = () => {
        for (const type of TAKEOVER_EVENTS) {
          element.removeEventListener(type, endJump, TAKEOVER_OPTIONS);
        }
      };
    },
    [armSettle, endJump, scrollRef]
  );

  useEffect(
    () => () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      endJump();
    },
    [endJump]
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
      // A report is proof the diff is still moving, so a jump in flight is not
      // settled yet however long it has already run.
      if (jumpTargetRef.current != null) armSettle();
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
        const jumpTarget = jumpTargetRef.current;
        if (jumpTarget != null) {
          // Still crossing files the reviewer did not ask to see. The mark is
          // already on the one they did, so this measurement is thrown away.
          if (found !== jumpTarget) return;
          // Arrived, and on the file the mark already names. Nothing to set.
          endJump();
          return;
        }
        setActiveItemId((current) => (current === found ? current : found));
      });
    }
  );

  // The measurement already scheduled read the offset the diff had before the
  // jump, so it is dropped rather than allowed to answer for the new one.
  const select = useCallback(
    (itemId: string) => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      setActiveItemId((current) => (current === itemId ? current : itemId));
      beginJump(itemId);
    },
    [beginJump]
  );

  return { activeItemId, onScroll, select };
}
