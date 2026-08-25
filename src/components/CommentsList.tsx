import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/cn';
import { commentPreviewText } from '@/lib/commentHeight';
import type { CommentListEntry, CommentListSection } from '@/lib/comments';

interface CommentsListProps {
  /** The thread the diff has selected. Its row is marked as the current one. */
  activeKey?: string;
  onSelectThread(thread: CommentListEntry): void;
  sections: readonly CommentListSection[];
  store: 'github' | 'local';
}

// One fixed-height row per thread.
//
// A row used to grow with its comment, so a review with long comments turned the
// panel into a wall of text that had to be scrolled to count. Every row is now
// the same height, which makes the list scannable and its scrolling cheap. The
// full text is one click away in the diff.
const ROW_HEIGHT = 52;

// The row reads left to right as who, what, where, how much. The two numbers on
// the right sit in columns of their own, each one as wide as the widest value in
// this review and each right-aligned, so a hundred rows form two straight
// columns of figures. The reply count keeps its column even on a thread with no
// replies, because a column that appears and disappears takes the line number
// column with it.
const REPLY_COLUMN = '2.25rem';

/**
 * U+200E, LEFT-TO-RIGHT MARK. It goes in front of a path rendered right to
 * left, so a path that opens on a dot or a slash keeps that character where it
 * belongs. See SectionHeading.
 */
const LRM = '\u200E';

/** How close the reveal may come to the right edge of the window. */
const REVEAL_MARGIN = 12;

/** The reveal's own right border. The path never sits under it. */
const REVEAL_BORDER = 1;

/**
 * One pixel on top of what the heading clips. `scrollWidth` and `clientWidth`
 * are whole pixels and the row's own box is not, so the two measurements can
 * fall a fraction short of the path. A pixel short leaves the ellipsis on a
 * path that has room, which is the one thing the reveal exists to remove.
 */
const REVEAL_SLACK = 1;

export function CommentsList({
  activeKey,
  onSelectThread,
  sections,
  store,
}: CommentsListProps) {
  // The widest line number in the list, so the column is exactly wide enough.
  const lineColumn = useMemo(() => {
    let digits = 1;
    for (const section of sections) {
      for (const thread of section.threads) {
        digits = Math.max(digits, String(thread.lineNumber).length);
      }
    }
    // One character for the leading sign, one for the space either side.
    return `${String(digits + 1)}ch`;
  }, [sections]);

  if (sections.length === 0) {
    return (
      <div className="text-ink-muted px-3 py-4 text-sm">
        <p>No comments here.</p>
        <p className="text-ink-faint mt-1 text-xs">
          {store === 'github'
            ? 'A comment you leave here becomes a pull request review comment on GitHub.'
            : 'This target has no GitHub review thread, so comments stay in this browser.'}
        </p>
      </div>
    );
  }

  return (
    // overflow-x-hidden, because a long path or an unbroken token in a preview
    // must never give the panel a horizontal scrollbar.
    <div className="cv-scrollbar h-full min-h-0 overflow-x-hidden overflow-y-auto pb-4">
      {sections.map((section) => (
        <section key={section.itemId} className="min-w-0">
          <SectionHeading path={section.path} />
          <ul className="min-w-0">
            {section.threads.map((thread) => (
              <li key={thread.key} className="min-w-0">
                <button
                  type="button"
                  aria-current={thread.key === activeKey ? 'true' : undefined}
                  onClick={() => onSelectThread(thread)}
                  style={{ height: ROW_HEIGHT }}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-2 overflow-hidden px-3 text-left',
                    'hover:bg-raised focus-visible:bg-raised',
                    'focus-visible:ring-accent focus-visible:ring-inset focus-visible:ring-2 focus-visible:outline-none',
                    // The thread the diff is showing. A bar on the leading edge
                    // rather than a border, so the row does not shift.
                    thread.key === activeKey &&
                      'bg-raised shadow-[inset_2px_0_0_var(--app-accent)]'
                  )}
                >
                  <AuthorAvatar thread={thread} />
                  <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="text-ink truncate text-xs font-medium">
                        {thread.author}
                      </span>
                      {thread.pending === true && (
                        <span className="text-ink-faint shrink-0 text-[10px]">
                          posting
                        </span>
                      )}
                      {thread.error != null && (
                        <span className="text-removed shrink-0 text-[10px]">
                          failed
                        </span>
                      )}
                    </span>
                    <span className="text-ink-muted min-w-0 truncate text-xs">
                      {commentPreviewText(thread.body)}
                    </span>
                  </span>
                  <span
                    className="text-ink-faint shrink-0 text-right font-mono text-[11px] tabular-nums"
                    style={{ width: lineColumn }}
                  >
                    {lineLabel(thread)}
                  </span>
                  <span
                    className="shrink-0 text-right"
                    style={{ width: REPLY_COLUMN }}
                  >
                    {thread.replyCount > 0 && (
                      <span className="bg-surface text-ink-muted rounded-full px-1.5 text-[10px] tabular-nums">
                        +{thread.replyCount}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The heading's own rectangle, and what of the path it holds back. */
interface RevealFrame {
  /** The width the heading clips. The reveal grows by exactly this. */
  clipped: number;
  height: number;
  left: number;
  top: number;
  width: number;
}

/**
 * The file a group of threads belongs to.
 *
 * The path is trimmed from its start, not its end. The end of a path is the
 * part that identifies the file, and a column of `components/CommentThre…`
 * against `components/CommentsLi…` says almost nothing. `dir="rtl"` is what
 * moves the ellipsis to the other end: the text itself stays left to right,
 * because every letter in a path is a strong left-to-right character, and the
 * leading LRM keeps a path that opens on a dot or a slash from being reordered
 * around it.
 *
 * The pointer over the row reveals the rest of the path on the row's own line.
 * See PathReveal.
 */
function SectionHeading({ path }: { path: string }) {
  const rowRef = useRef<HTMLHeadingElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [frame, setFrame] = useState<RevealFrame | null>(null);
  const close = useCallback(() => setFrame(null), []);

  // The pointer arriving on the row opens the reveal, and a move inside the row
  // is what re-arms it: a scroll closes the layer without the pointer having
  // left, so no second `mouseenter` is coming to open it again.
  const open = () => {
    const row = rowRef.current;
    const text = textRef.current;
    if (frame != null || row == null || text == null) return;
    // A path the heading already shows whole has nothing to reveal, and a
    // layer that grew by nothing over the top of it would only blink.
    const clipped = text.scrollWidth - text.clientWidth;
    if (clipped < 1) return;
    const box = row.getBoundingClientRect();
    setFrame({
      clipped,
      height: box.height,
      left: box.left,
      top: box.top,
      width: box.width,
    });
  };

  return (
    <h3
      ref={rowRef}
      className="bg-surface sticky top-0 z-10 px-3 py-1"
      onMouseEnter={open}
      onMouseMove={open}
      onMouseLeave={close}
    >
      <span
        ref={textRef}
        dir="rtl"
        className="text-ink-faint block truncate text-left font-mono text-[11px]"
      >
        {LRM + path}
      </span>
      {frame != null && (
        <PathReveal frame={frame} onClose={close} path={path} />
      )}
    </h3>
  );
}

/**
 * The whole path, on the line the heading already occupies.
 *
 * The heading clips the start of the path, so the rest of it can arrive one way
 * only: the path is anchored to the right edge of its box, and a box that grows
 * to the right carries every character the row already shows to the right with
 * it while the missing directories appear at the clip. The layer starts at the
 * heading's own rectangle and grows by exactly what the heading clips, so it
 * reads as the row stretching rather than a second copy of it arriving, and it
 * crosses the sidebar's border and sits over the diff for the width it needs.
 *
 * A fixed layer in a portal is what buys that reach. The list scrolls in a
 * region that hides horizontal overflow — a long path must never give the panel
 * a scrollbar — and that region clips an absolute child of the heading just as
 * hard.
 *
 * The layer takes no pointer events. It covers the row it belongs to, and a
 * pointer that entered it would leave the heading and close it, once a frame.
 * It closes on a scroll rather than following the row, because the heading is
 * sticky and its section leaves without it.
 */
function PathReveal({
  frame,
  onClose,
  path,
}: {
  frame: RevealFrame;
  onClose(): void;
  path: string;
}) {
  const [grown, setGrown] = useState(false);

  // The browser needs one frame at the resting width to transition from.
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const rest = frame.width + REVEAL_BORDER;
  const wanted = rest + frame.clipped + REVEAL_SLACK;
  // The window is the only limit. A path too long for it keeps its ellipsis.
  const room = window.innerWidth - frame.left - REVEAL_MARGIN;
  const width = grown ? Math.max(rest, Math.min(wanted, room)) : rest;

  return createPortal(
    <div
      aria-hidden="true"
      className={cn(
        'border-line bg-raised pointer-events-none fixed z-40 flex items-center',
        'overflow-hidden rounded-r-md border border-l-0 shadow-lg',
        'motion-safe:transition-[width] motion-safe:duration-200',
        'motion-safe:ease-[cubic-bezier(0.32,0.72,0,1)]'
      )}
      style={{ height: frame.height, left: frame.left, top: frame.top, width }}
    >
      {/* The heading's own padding, so the path lands on the pixel it left. */}
      <span
        dir="rtl"
        className="text-ink min-w-0 flex-1 truncate px-3 text-left font-mono text-[11px]"
      >
        {LRM + path}
      </span>
    </div>,
    document.body
  );
}

/**
 * The account that opened the thread, in the place the line number used to sit.
 * A face, or a robot's logo, is read faster than a login, which is what makes a
 * bot's wall of comments skippable at a glance.
 */
function AuthorAvatar({ thread }: { thread: CommentListEntry }) {
  const shared = 'size-5 shrink-0 rounded-full border border-line object-cover';
  if (thread.authorAvatarUrl != null) {
    return (
      <img
        alt=""
        aria-hidden="true"
        className={cn(shared, thread.authorIsBot && 'rounded-sm')}
        height={20}
        loading="lazy"
        src={thread.authorAvatarUrl}
        width={20}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        shared,
        'bg-surface text-ink-faint flex items-center justify-center text-[10px] font-semibold uppercase',
        thread.authorIsBot && 'rounded-sm'
      )}
    >
      {thread.author.slice(0, 1)}
    </span>
  );
}

function lineLabel(thread: CommentListEntry): string {
  if (thread.lineType === 'context') {
    return `L${thread.lineNumber}`;
  }
  return thread.side === 'additions'
    ? `+${thread.lineNumber}`
    : `-${thread.lineNumber}`;
}
