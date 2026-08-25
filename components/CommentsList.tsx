'use client';

import { cn } from '@/lib/cn';
import type { CommentListEntry, CommentListSection } from '@/lib/comments';

interface CommentsListProps {
  onSelectComment(comment: CommentListEntry): void;
  sections: readonly CommentListSection[];
  store: 'github' | 'local';
}

export function CommentsList({
  onSelectComment,
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
    <div className="cv-scrollbar h-full min-h-0 overflow-y-auto px-1 pb-4">
      {sections.map((section) => (
        <section key={section.itemId} className="mb-3">
          <h3 className="text-ink-faint sticky top-0 bg-[var(--app-surface)] px-2 py-1 font-mono text-xs">
            {section.path}
          </h3>
          <ul>
            {section.comments.map((comment) => (
              <li key={comment.key}>
                <button
                  type="button"
                  onClick={() => onSelectComment(comment)}
                  className={cn(
                    'hover:bg-raised w-full rounded-md px-2 py-1.5 text-left',
                    'focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none'
                  )}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="text-ink-faint font-mono text-[11px] tabular-nums">
                      {lineLabel(comment)}
                    </span>
                    <span className="text-ink truncate text-xs font-medium">
                      {comment.author}
                    </span>
                    {comment.pending === true && (
                      <span className="text-ink-faint text-[11px]">
                        posting
                      </span>
                    )}
                    {comment.error != null && (
                      <span className="text-removed text-[11px]">failed</span>
                    )}
                  </span>
                  <span className="text-ink-muted mt-0.5 line-clamp-2 block text-sm">
                    {comment.body}
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

function lineLabel(comment: CommentListEntry): string {
  if (comment.lineType === 'context') {
    return `L${comment.lineNumber}`;
  }
  return comment.side === 'additions'
    ? `+${comment.lineNumber}`
    : `-${comment.lineNumber}`;
}
