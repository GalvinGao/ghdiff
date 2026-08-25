import { useMemo } from 'react';

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

/**
 * U+200B, ZERO WIDTH SPACE, after each separator. A path holds no spaces, so
 * without it the hover layer would wrap by breaking a directory name in half.
 * With it the wrap happens at the slashes, where a reader expects it.
 */
function wrappablePath(path: string): string {
  return path.replaceAll('/', '/\u200B');
}

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
 * Hovering shows the whole path in a small layer under the heading. It wraps
 * rather than reaching past the panel, so nothing about it depends on how wide
 * the sidebar has been dragged.
 */
function SectionHeading({ path }: { path: string }) {
  return (
    <h3 className="bg-surface group relative sticky top-0 z-10 px-3 py-1 hover:z-30">
      <span
        dir="rtl"
        className="text-ink-faint block truncate text-left font-mono text-[11px]"
      >
        {LRM + path}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'border-line bg-raised text-ink pointer-events-none absolute inset-x-2 top-[calc(100%-3px)]',
          'z-30 rounded-md border px-2 py-1 font-mono text-[10px] leading-snug break-words shadow-lg',
          'origin-top scale-[0.98] opacity-0 transition-[opacity,transform] duration-100 ease-out',
          'group-hover:scale-100 group-hover:opacity-100',
          'motion-reduce:transition-none'
        )}
      >
        {wrappablePath(path)}
      </span>
    </h3>
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
