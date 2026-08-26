import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/cn';

// The expanded reading view for one comment.
//
// It is a fixed-position layer in a portal, not a taller card. The card in the
// diff keeps the exact height it reserved, so @pierre/diffs never re-measures
// the annotation and never relays out the virtualized list. Expanding a comment
// therefore costs the diff nothing.
//
// It opens from the card's own rectangle and grows in place, so it reads as the
// card expanding rather than a dialog arriving from elsewhere. When the card
// sits low in the viewport there is no room below it, so the layer also moves
// up by the smallest amount that fits.

const MARGIN = 12;
const MIN_WIDTH = 420;

interface Frame {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface CommentExpansionProps {
  /** The card being expanded. Its rectangle is the opening frame. */
  anchor: HTMLElement;
  children: ReactNode;
  /**
   * Changes when the content changes height, which re-measures the layer. A
   * reply added to the thread is the case that needs it: the panel has to grow
   * to the message the reviewer just wrote instead of scrolling it off.
   */
  measureKey?: number | string;
  onClose(): void;
}

export function CommentExpansion({
  anchor,
  children,
  measureKey,
  onClose,
}: CommentExpansionProps) {
  const [from] = useState<Frame>(() => {
    const box = anchor.getBoundingClientRect();
    return {
      top: box.top,
      left: box.left,
      width: box.width,
      height: box.height,
    };
  });
  const [to, setTo] = useState<Frame | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Measure the content once, then grow to it on the next frame so the browser
  // has a starting rectangle to transition from. This read happens outside the
  // CodeView, so it costs the diff nothing.
  useLayoutEffect(() => {
    const content = contentRef.current;
    const panel = panelRef.current;
    if (content == null || panel == null) return undefined;

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const width = Math.min(
      Math.max(from.width, MIN_WIDTH),
      viewportWidth - MARGIN * 2
    );
    // How tall the comments are is a question about the box they are read in,
    // so the panel is given the box it is about to have and asked afterwards.
    // Every write here is undone before the effect returns, so the browser
    // paints none of it and the panel still travels from the card's rectangle.
    //
    // The height of that box matters as much as its width. Measured in a panel
    // still as short as the card, the scroll region carries a scrollbar it is
    // about to lose, every paragraph wraps eight pixels early, and the panel
    // ends up sized for lines that will not be there.
    //
    // The box that holds the comments is what answers. The scroll region around
    // it cannot: it is `h-full` of a panel that still has the card's height, so
    // its `scrollHeight` never reports less than the card, and the card is the
    // height of these same words in a column a third as wide. That floor is
    // what left a band of empty panel under the last line.
    //
    // The panel is sized border box, so its border is added back here. Without
    // it the scroll region ends up two pixels short of its own content and
    // grows a scrollbar for them.
    const border = panel.offsetHeight - panel.clientHeight;
    const maxHeight = viewportHeight - MARGIN * 2;
    const startWidth = panel.style.width;
    const startHeight = panel.style.height;
    // The panel transitions its own width and height, and a transition is
    // exactly what must not be running for this: a box read back while one is
    // under way is the box it started from, which is the card's, and the answer
    // would be the tall wrap this measurement exists to avoid. Turning it off,
    // writing, reading, and putting the panel back is one uninterrupted script
    // turn, so nothing is left for a transition to animate afterwards.
    panel.style.transition = 'none';
    panel.style.width = `${String(width)}px`;
    panel.style.height = `${String(maxHeight)}px`;
    const wanted = content.getBoundingClientRect().height + border;
    panel.style.width = startWidth;
    panel.style.height = startHeight;
    // Settle the restored box before the transition comes back.
    void panel.offsetHeight;
    panel.style.transition = '';
    const height = Math.min(wanted, maxHeight);
    const left = Math.min(
      Math.max(from.left, MARGIN),
      viewportWidth - width - MARGIN
    );
    // Prefer the card's own top. Move up only as far as fitting requires.
    const top = Math.min(
      Math.max(from.top, MARGIN),
      Math.max(viewportHeight - height - MARGIN, MARGIN)
    );

    const id = requestAnimationFrame(() => setTo({ top, left, width, height }));
    return () => cancelAnimationFrame(id);
    // measureKey is a signal, not a value this reads: it changes when the
    // content has grown, and re-running is the whole point of it. scrollHeight
    // is still the full content height on a second run, because the panel
    // clips its content rather than growing with it.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [from, measureKey]);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (panelRef.current?.contains(event.target) === true) return;
      close();
    };
    // Scrolling the diff moves the card out from under the layer, so the layer
    // closes rather than floating over an unrelated line.
    const onScroll = () => close();

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [close]);

  const frame = to ?? from;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label="Comment"
      className={cn(
        'border-line bg-raised fixed z-50 overflow-hidden rounded-lg border shadow-2xl',
        'motion-safe:transition-[top,left,width,height,opacity]',
        'motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.32,0.72,0,1)]'
      )}
      style={{
        top: frame.top,
        left: frame.left,
        width: frame.width,
        height: frame.height,
        opacity: to == null ? 0.9 : 1,
      }}
    >
      {/* The padding is on the measured box rather than on the scroll region,
          so one rectangle holds the whole of what the panel has to fit. */}
      <div className="cv-scrollbar h-full overflow-y-auto overscroll-contain">
        <div ref={contentRef} className="p-3">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
