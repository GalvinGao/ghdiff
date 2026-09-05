import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { pullStateLabel } from '@/components/PullStateIcon';
import type { PullSummary } from '@/lib/pulls';

const OPEN_DELAY = 350;
const CLOSE_DELAY = 120;
const MARGIN = 12;
const GAP = 10;

interface HoverTarget {
  pull: PullSummary;
  anchor: HTMLElement;
}

interface HoverActions {
  show(pull: PullSummary, anchor: HTMLElement, immediate?: boolean): void;
  leave(): void;
  dismiss(): void;
}

const HoverContext = createContext<HoverActions | null>(null);

export function usePullHoverCard() {
  return useContext(HoverContext);
}

/** One persistent card for the live collapsed rail. Retargeting it preserves
 * the DOM node, so CSS can interrupt a flight from any intermediate position. */
export function PullHoverCardProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HoverTarget | null>(null);
  const [visible, setVisible] = useState(false);
  const active = useRef<HoverTarget | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const panel = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const clearTimers = useCallback(() => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  }, []);

  const dismiss = useCallback(() => {
    clearTimers();
    active.current = null;
    setTarget(null);
    setVisible(false);
  }, [clearTimers]);

  const keepOpen = useCallback(() => {
    clearTimers();
    if (active.current != null) setVisible(true);
  }, [clearTimers]);

  const show = useCallback(
    (pull: PullSummary, anchor: HTMLElement, immediate = false) => {
      clearTimers();
      const open = () => {
        if (!anchor.isConnected || anchor.getClientRects().length === 0) return;
        active.current = { pull, anchor };
        setTarget(active.current);
        setVisible(true);
      };
      // Only the first icon waits. Crossing a stack badge or the gap between
      // rows keeps the same card alive, including during its exit fade.
      if (active.current != null || immediate) open();
      else openTimer.current = setTimeout(open, OPEN_DELAY);
    },
    [clearTimers]
  );

  const leave = useCallback(() => {
    clearTimers();
    closeTimer.current = setTimeout(() => {
      setVisible(false);
      closeTimer.current = setTimeout(dismiss, CLOSE_DELAY);
    }, CLOSE_DELAY);
  }, [clearTimers, dismiss]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    const onScroll = (event: Event) => {
      // A very short viewport may scroll the card's own content.
      if (event.target instanceof Node && panel.current?.contains(event.target))
        return;
      dismiss();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && panel.current?.contains(event.target))
        return;
      dismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('blur', dismiss);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      clearTimers();
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [clearTimers, dismiss]);

  const actions = useMemo(
    () => ({ show, leave, dismiss }),
    [show, leave, dismiss]
  );

  // Measure the natural content, not the height currently in flight. Both
  // height and position use the same easing so the bottom edge also stays
  // inside the viewport when a longer title arrives near the last icon.
  const measure = useCallback(
    (card: HTMLDivElement | null) => {
      panel.current = card;
      const content = contentRef.current;
      if (content == null || card == null || target == null) return;
      const place = (animate = true) => {
        if (
          !target.anchor.isConnected ||
          target.anchor.getClientRects().length === 0
        ) {
          dismiss();
          return;
        }
        // The first card fades at its anchor; it must not fly from (0, 0)
        // when the width measurement settles its initial computed style.
        const firstPlacement = card.style.transform === '';
        if (firstPlacement) card.style.transitionProperty = 'opacity';
        else if (!animate) card.style.transition = 'none';
        const viewport = window.visualViewport;
        const leftEdge = viewport?.offsetLeft ?? 0;
        const topEdge = viewport?.offsetTop ?? 0;
        const width = viewport?.width ?? document.documentElement.clientWidth;
        const height = viewport?.height ?? window.innerHeight;
        card.style.width = `${String(Math.max(0, Math.min(320, width - MARGIN * 2)))}px`;
        const cardHeight = Math.min(
          content.offsetHeight,
          Math.max(0, height - MARGIN * 2)
        );
        const anchor = target.anchor.getBoundingClientRect();
        const x = Math.max(
          leftEdge + MARGIN,
          Math.min(
            anchor.right + GAP,
            leftEdge + width - card.offsetWidth - MARGIN
          )
        );
        const y = Math.max(
          topEdge + MARGIN,
          Math.min(anchor.top, topEdge + height - cardHeight - MARGIN)
        );
        // A shrinking viewport must fit immediately, even mid-flight.
        card.style.height = `${String(cardHeight)}px`;
        card.style.transform = `translate(${String(x)}px, ${String(y)}px)`;
        if (firstPlacement || !animate) {
          void card.offsetHeight;
          card.style.transition = '';
          card.style.transitionProperty = '';
        }
      };
      place();
      const observer = new ResizeObserver(() => place());
      observer.observe(content);
      observer.observe(target.anchor);
      const onResize = () => place(false);
      window.addEventListener('resize', onResize);
      window.visualViewport?.addEventListener('resize', onResize);
      window.visualViewport?.addEventListener('scroll', onResize);
      return () => {
        panel.current = null;
        observer.disconnect();
        window.removeEventListener('resize', onResize);
        window.visualViewport?.removeEventListener('resize', onResize);
        window.visualViewport?.removeEventListener('scroll', onResize);
      };
    },
    [target, dismiss]
  );

  return (
    <HoverContext value={actions}>
      {children}
      {target != null &&
        createPortal(
          <div
            ref={measure}
            data-pull-hover-card=""
            data-open={visible ? '' : undefined}
            // The link already names this PR for a screen reader. The card is a
            // visual expansion of that label and never takes keyboard focus.
            aria-hidden="true"
            className="bg-raised text-ink ring-line pointer-events-none fixed top-0 left-0 z-50 overflow-y-auto overscroll-contain rounded-lg opacity-0 shadow-lg ring-1 transition-[transform,height,opacity] duration-120 ease-[cubic-bezier(0.2,0,0,1)] data-open:pointer-events-auto data-open:opacity-100 data-open:duration-180 motion-reduce:transition-none starting:data-open:opacity-0"
            onPointerEnter={keepOpen}
            onPointerLeave={leave}
          >
            <div ref={contentRef} className="p-3">
              <p className="text-sm leading-5 font-medium text-pretty wrap-anywhere">
                {target.pull.title}
              </p>
              <p className="text-ink-muted mt-1.5 text-xs leading-4 wrap-anywhere">
                {target.pull.owner}/{target.pull.repo}{' '}
                <span className="tabular-nums">#{target.pull.number}</span>
              </p>
              <p className="text-ink-faint mt-1 text-xs leading-4 wrap-anywhere">
                {target.pull.author} · {pullStateLabel(target.pull.state)}
              </p>
            </div>
          </div>,
          document.body
        )}
    </HoverContext>
  );
}
