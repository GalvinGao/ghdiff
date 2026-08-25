'use client';

import { cn } from '@/lib/cn';
import { commentPreviewText } from '@/lib/commentHeight';
import type { CommentListEntry, CommentListSection } from '@/lib/comments';

interface CommentsListProps {
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

export function CommentsList({
  onSelectThread,
  sections,
  store,
}: CommentsListProps) {
  if (sections.length === 0) {
    return (
      <div className="text-ink-muted px-3 py-4 text-sm">
        <p>No comments yet.</p>
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
          <h3
            className="text-ink-faint bg-surface sticky top-0 z-10 truncate px-3 py-1 font-mono text-[11px]"
            title={section.path}
          >
            {section.path}
          </h3>
          <ul className="min-w-0">
            {section.threads.map((thread) => (
              <li key={thread.key} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onSelectThread(thread)}
                  style={{ height: ROW_HEIGHT }}
                  className={cn(
                    'flex w-full min-w-0 flex-col justify-center gap-0.5 overflow-hidden px-3 text-left',
                    'hover:bg-raised focus-visible:bg-raised',
                    'focus-visible:ring-accent focus-visible:ring-inset focus-visible:ring-2 focus-visible:outline-none'
                  )}
                >
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="text-ink-faint shrink-0 font-mono text-[11px] tabular-nums">
                      {lineLabel(thread)}
                    </span>
                    <span className="text-ink truncate text-xs font-medium">
                      {thread.author}
                    </span>
                    {thread.replyCount > 0 && (
                      <span className="bg-surface text-ink-muted shrink-0 rounded-full px-1.5 text-[10px] tabular-nums">
                        +{thread.replyCount}
                      </span>
                    )}
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
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
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
