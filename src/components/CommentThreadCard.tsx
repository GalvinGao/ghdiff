import { IconReply } from '@pierre/icons';
import { useCallback, useMemo, useRef, useState } from 'react';

import { AuthorAvatar } from '@/components/AuthorAvatar';
import { CommentBody } from '@/components/CommentBody';
import { CommentExpansion } from '@/components/CommentExpansion';
import { ConfirmInline } from '@/components/ConfirmInline';
import { Button } from '@/components/ui/Button';
import { useCommentDraft } from '@/hooks/useCommentDraft';
import type { CommentStore } from '@/hooks/useReviewComments';
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
  onReply(itemId: string, key: string, body: string): void;
  /** Where a reply would go, which decides whether one can be written. */
  store: CommentStore;
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
 * A reply is the one thing that re-measures the card, because it adds a message
 * to the thread the height was taken from. That is one relayout for one
 * deliberate act, and it is the same relayout that posting the first comment on
 * a line already costs. Nothing else here changes size: the card still never
 * grows on its own, and reading it still costs the diff nothing.
 *
 * The whole card is the control. There is no expand button: a preview this
 * small is not for reading, so clicking anywhere in it opens the thread.
 */
export function CommentThreadCard({
  itemId,
  metadata,
  onDelete,
  onReply,
  store,
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

  /**
   * Whether an event belongs to the card rather than to the expanded layer.
   * The layer is a portal, so its DOM sits on document.body, but React still
   * bubbles its events through this component. Without this test, typing a
   * space into the reply box would be read as "open the thread".
   */
  const isOwnEvent = useCallback((target: EventTarget | null): boolean => {
    return target instanceof Node && cardRef.current?.contains(target) === true;
  }, []);

  if (!isCommentThread(metadata)) return null;

  const comments: ThreadComment[] = metadata.comments;
  const root = comments[0];
  const replyCount = comments.length - 1;
  const participants = threadParticipants(metadata);
  // GitHub files a reply under the thread of the comment it answers, so the
  // root has to exist there first.
  const canReply = store === 'local' || root.githubId != null;

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      aria-expanded={anchor != null}
      aria-label={`Open thread by ${root.author}`}
      onClick={(event) => {
        if (!isOwnEvent(event.target)) return;
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
        if (!isOwnEvent(event.target)) return;
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
        {/*
          16px, which fits inside the 20px line box the login already draws, so
          the picture costs the header no height. A card that grew here would
          relay out the virtualized list. See lib/commentHeight.ts.
        */}
        <AuthorAvatar
          author={root.author}
          avatarUrl={root.authorAvatarUrl}
          isBot={root.authorIsBot}
          size={16}
        />
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
        <CommentExpansion
          anchor={anchor}
          // The layer re-measures when the thread gains a message, so a reply
          // pushes the panel taller instead of being scrolled out of sight.
          measureKey={comments.length}
          onClose={close}
        >
          {/*
            No picture on this row. It is the panel's own chrome, and every
            message under it already carries the picture of whoever wrote it —
            one beside "4 comments" would name only the first of the four.
          */}
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
                {/*
                  items-center, not items-baseline: a picture has no baseline
                  of its own, and a row aligned on one would hang it below the
                  login it belongs to.
                */}
                <div className="mb-1 flex items-center gap-2">
                  <AuthorAvatar
                    author={comment.author}
                    avatarUrl={comment.authorAvatarUrl}
                    isBot={comment.authorIsBot}
                    size={20}
                  />
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

          {canReply ? (
            <ReplyForm
              draftKey={`reply:${itemId}:${metadata.key}`}
              onSubmit={(body) => onReply(itemId, metadata.key, body)}
              pending={metadata.pending === true}
              store={store}
            />
          ) : (
            <p className="border-line text-ink-faint mt-3 border-t pt-3 text-[11px]">
              This comment has not reached GitHub yet, so it cannot take a
              reply.
            </p>
          )}
        </CommentExpansion>
      )}
    </div>
  );
}

/**
 * The reply box at the foot of an open thread.
 *
 * It is always open rather than hidden behind a Reply button. Answering a
 * comment is the reason the thread was expanded most of the time, and a review
 * is a long sequence of that one act, so the box costs one click less every
 * time. It clears itself on submit, because the message it sent is already in
 * the list above it.
 */
function ReplyForm({
  draftKey,
  onSubmit,
  pending,
  store,
}: {
  draftKey: string;
  onSubmit(body: string): void;
  pending: boolean;
  store: CommentStore;
}) {
  const [body, setBody] = useCommentDraft(draftKey);
  const canSend = body.trim().length > 0 && !pending;

  const send = () => {
    if (!canSend) return;
    onSubmit(body);
    setBody('');
  };

  return (
    <form
      className="border-line mt-3 border-t pt-3 font-sans"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <textarea
        value={body}
        rows={2}
        placeholder={
          store === 'github' ? 'Reply on GitHub' : 'Reply in this browser'
        }
        className={cn(
          'border-line bg-canvas text-ink placeholder:text-ink-faint w-full resize-y rounded-md border p-2 text-sm',
          'focus-visible:border-accent focus-visible:outline-none'
        )}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          // Cmd or Ctrl with Enter sends, which matches GitHub. Escape is left
          // to the layer, which closes on it.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            send();
          }
        }}
      />
      <div className="mt-2 flex items-center gap-2">
        <Button disabled={!canSend} size="sm" type="submit" variant="solid">
          <IconReply size={13} />
          {pending ? 'Sending…' : 'Reply'}
        </Button>
        <span className="text-ink-faint ml-auto text-[11px]">
          Cmd or Ctrl with Enter
        </span>
      </div>
    </form>
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
