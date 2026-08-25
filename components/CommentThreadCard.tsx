'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import { CommentBody } from '@/components/CommentBody';
import { CommentExpansion } from '@/components/CommentExpansion';
import { ConfirmInline } from '@/components/ConfirmInline';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { measureThread } from '@/lib/commentHeight';
import {
  type CommentMetadata,
  isCommentThread,
  type ThreadComment,
  threadParticipants,
} from '@/lib/comments';

interface CommentThreadCardProps {
  itemId: string;
  metadata: CommentMetadata;
  onDelete(itemId: string, key: string): void;
}

/**
 * One comment thread inside the diff, as a single card.
 *
 * GitHub returns a root comment and its replies as separate rows. Stacking each
 * as its own card buried the diff, so the whole conversation lives in one card
 * and expanding it opens every message at once.
 *
 * The body region has a height chosen from the text before the first paint and
 * never changes it. @pierre/diffs watches this element with a ResizeObserver,
 * so a card that grew would relay out the virtualized list. Reading the thread
 * happens in an overlay instead. See lib/commentHeight.ts.
 *
 * The whole card is the control. There is no expand button: a preview this
 * small is not for reading, so clicking anywhere in it opens the thread.
 */
export function CommentThreadCard({
  itemId,
  metadata,
  onDelete,
}: CommentThreadCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  // The element the overlay grows from. Captured in the handler, because a ref
  // must not be read while rendering.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  // Measured from metadata.comments, which state owns, so the memo is stable.
  const spec = useMemo(
    () => measureThread((metadata.comments ?? []).map((c) => c.body)),
    [metadata.comments]
  );

  const open = useCallback(() => setAnchor(cardRef.current), []);
  const close = useCallback(() => setAnchor(null), []);

  if (!isCommentThread(metadata)) return null;

  const comments: ThreadComment[] = metadata.comments;
  const root = comments[0];
  const replyCount = comments.length - 1;
  const participants = threadParticipants(metadata);

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      aria-expanded={anchor != null}
      aria-label={`Open thread by ${root.author}`}
      onClick={(event) => {
        // A link or a button inside the card keeps its own behaviour.
        if (
          event.target instanceof Element &&
          event.target.closest('a,button') != null
        ) {
          return;
        }
        open();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      }}
      className={cn(
        'border-line bg-raised text-ink m-2 cursor-pointer rounded-lg border p-2.5',
        'text-left shadow-sm transition-colors',
        // A comment is prose, and prose is unreadable across the full width of a
        // split diff. This cap keeps a line near 90 characters, which is still
        // wide enough that lib/commentHeight.ts's one-line bucket holds.
        'max-w-[42rem]',
        'hover:border-accent/50 hover:bg-surface',
        'focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none',
        // The diff sets a monospace family on its annotation slot. Prose is
        // read, not scanned column by column, so the card opts out.
        'font-sans'
      )}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="truncate text-[13px] font-semibold">
          {root.author}
        </span>
        {replyCount > 0 && (
          <span className="bg-surface text-ink-muted shrink-0 rounded-full px-1.5 py-px text-[11px] tabular-nums">
            {replyCount === 1 ? '1 reply' : `${replyCount} replies`}
          </span>
        )}
        {participants.length > 1 && (
          <span className="text-ink-faint truncate text-[11px]">
            {participants.slice(1).join(', ')}
          </span>
        )}
        {metadata.pending === true && (
          <span className="text-ink-faint shrink-0 text-[11px]">Posting…</span>
        )}
        <span className="text-ink-faint ml-auto shrink-0 text-[11px]">
          Click to open
        </span>
      </div>

      <div
        // A fixed height, not a maximum. The card measures the same whatever
        // the markdown turns out to be, and a late-loading image is clipped
        // rather than pushing the card taller.
        style={{ height: spec.bodyHeight }}
        className="relative overflow-hidden"
      >
        <CommentBody body={root.body} />
        <div
          aria-hidden="true"
          className="from-raised pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t to-transparent"
        />
      </div>

      {metadata.error != null && (
        <p className="text-removed mt-1.5 text-[11px]">{metadata.error}</p>
      )}

      {anchor != null && (
        <CommentExpansion anchor={anchor} onClose={close}>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-ink text-sm font-semibold">
              {comments.length === 1
                ? root.author
                : `${comments.length} comments`}
            </span>
            <ConfirmInline
              className="ml-auto"
              label="Delete"
              question={
                comments.length === 1
                  ? 'Delete this comment on GitHub? This cannot be undone.'
                  : `Delete all ${comments.length} comments in this thread on GitHub? This cannot be undone.`
              }
              confirmLabel="Delete"
              onConfirm={() => {
                close();
                onDelete(itemId, metadata.key);
              }}
            />
            <Button variant="outline" size="sm" onClick={close}>
              Close
            </Button>
          </div>

          <ol className="font-sans">
            {comments.map((comment, index) => (
              <li
                key={comment.key}
                className={cn(
                  index > 0 && 'border-line mt-2.5 border-t pt-2.5'
                )}
              >
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="text-ink text-[13px] font-semibold">
                    {comment.author}
                  </span>
                  {comment.createdAt != null && (
                    <span className="text-ink-faint text-[11px]">
                      {formatWhen(comment.createdAt)}
                    </span>
                  )}
                  {comment.htmlUrl != null && (
                    <a
                      href={comment.htmlUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-ink-faint hover:text-accent ml-auto text-[11px] underline"
                    >
                      On GitHub
                    </a>
                  )}
                </div>
                <CommentBody body={comment.body} />
              </li>
            ))}
          </ol>
        </CommentExpansion>
      )}
    </div>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
