import { IconArrowUpRight, IconReply } from '@pierre/icons';
import { useCallback, useMemo, useRef, useState } from 'react';

import { AuthorAvatar } from '@/components/AuthorAvatar';
import { CommentBody } from '@/components/CommentBody';
import { CommentExpansion } from '@/components/CommentExpansion';
import { ConfirmInline } from '@/components/ConfirmInline';
import { Button } from '@/components/ui/Button';
import { buttonClass } from '@/components/ui/buttonClass';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  type CommentStore,
  threadWritePending,
} from '@/hooks/useReviewComments';
import { cn } from '@/lib/cn';
import { measureThread } from '@/lib/commentHeight';
import {
  type CommentMetadata,
  type CommentThread,
  isCommentThread,
  type ThreadComment,
  threadParticipants,
} from '@/lib/comments';
import { forgeLabel, type ForgeName } from '@/lib/forges';
import { formatList, textDirection } from '@/lib/locale';
import { m } from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

interface CommentThreadCardProps {
  /** The target's own forge: the delete question and the link out name it. */
  forge: ForgeName;
  itemId: string;
  metadata: CommentMetadata;
  onDelete(itemId: string, key: string): void;
  onReply(itemId: string, key: string, body: string): void;
  /**
   * Resolves the thread on its forge, or takes the mark back. Absent where
   * no forge thread can be resolved; the card offers the press only for a
   * thread that carries a `threadId` and is no draft.
   */
  onResolveThread?(
    itemId: string,
    key: string,
    resolved: boolean
  ): Promise<void>;
  /** Where a reply would go, which decides whether one can be written. */
  store: CommentStore;
}

/**
 * Why Delete is grey while a write is on the wire. The card's own header
 * already says `Posting…`; this is the answer to "and when can I delete it".
 */
const DELETE_BLOCKED_TIP =
  m.comment_thread_card_delete_is_back_when_the_write_in_flight;

/**
 * Whether the card may offer the resolve press: a forge thread that carries
 * the id its resolve call addresses, no draft and no browser-only comment,
 * and a handler to call.
 */
function threadResolvable(
  metadata: CommentThread,
  onResolveThread: CommentThreadCardProps['onResolveThread']
): boolean {
  return (
    metadata.threadId != null &&
    metadata.staged !== true &&
    onResolveThread != null
  );
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
  forge,
  itemId,
  metadata,
  onDelete,
  onReply,
  onResolveThread,
  store,
}: CommentThreadCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  // The element the overlay grows from. Captured in the handler, because a ref
  // must not be read while rendering.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // A resolved thread starts collapsed to one row; a press brings the card.
  const [opened, setOpened] = useState(false);
  // True while the forge answers an Unresolve press on the collapsed row.
  const [unresolving, setUnresolving] = useState(false);

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
  // A draft reply under a posted thread goes up with the verdict too, so the
  // card says Draft for it as well — without the dashed border, which is the
  // whole-thread draft's alone.
  const holdsDraft =
    metadata.staged === true || comments.some((comment) => comment.staged);
  const participants = threadParticipants(metadata);
  const canResolve = threadResolvable(metadata, onResolveThread);

  // A resolved thread is a line, not a wall: it reads as settled until the
  // reviewer asks for it. The press brings the whole card back, which is the
  // one relayout a deliberate act always costs.
  if (metadata.resolved === true && !opened) {
    return (
      <div className="m-2">
        {/*
          Two sibling buttons rather than one role="button" row with the
          Unresolve button nested inside it: ARIA strips a nested button's
          role while it stays focusable.
        */}
        <div
          className={cn(
            'border-line bg-surface text-ink-muted flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5',
            'text-left text-[11px]',
            'hover:border-accent/50 hover:bg-raised'
          )}
        >
          <button
            type="button"
            aria-label={m.comment_thread_card_open_resolved_thread_by({
              author: root.author,
            })}
            onClick={() => setOpened(true)}
            className="focus-visible:ring-accent flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none"
          >
            <span className="bg-surface text-ink-faint border-line shrink-0 rounded-full border px-1.5 py-px">
              {m.comment_thread_card_resolved()}
            </span>
            <span className="truncate font-medium">{root.author}</span>
            <span className="shrink-0 tabular-nums">
              {m.common_comment_count({ count: comments.length })}
            </span>
            {!canResolve && (
              <span className="text-ink-faint ml-auto shrink-0">
                {m.comment_thread_card_open()}
              </span>
            )}
          </button>
          {canResolve && (
            <button
              type="button"
              disabled={unresolving}
              onClick={() => {
                if (onResolveThread == null) return;
                setUnresolving(true);
                void onResolveThread(itemId, metadata.key, false).finally(() =>
                  setUnresolving(false)
                );
              }}
              className="text-ink-faint hover:text-accent shrink-0 cursor-pointer underline disabled:no-underline disabled:opacity-60"
            >
              {unresolving
                ? m.comment_thread_card_unresolving()
                : m.comment_thread_card_unresolve()}
            </button>
          )}
        </div>
        {/* A failed Unresolve rolls the mark back and says why, here, because
            the row itself is one line with no room for the sentence. */}
        {metadata.error != null && (
          <p className="text-removed mt-1 text-[11px]">{metadata.error}</p>
        )}
      </div>
    );
  }

  return (
    <div
      dir={textDirection(getLocale())}
      ref={cardRef}
      role="button"
      tabIndex={0}
      aria-expanded={anchor != null}
      aria-label={m.comment_thread_card_open_thread_by({ author: root.author })}
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
        'font-sans',
        // A draft can never read as posted: the border says it before any chip.
        metadata.staged === true && 'border-dashed border-accent/60'
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
            {m.common_reply_count({ count: replyCount })}
          </span>
        )}
        {participants.length > 1 && (
          <span className="text-ink-faint truncate text-[11px]">
            {formatList(participants.slice(1))}
          </span>
        )}
        {metadata.pending === true && (
          <span className="text-ink-faint shrink-0 text-[11px]">
            {metadata.creatingIssue === true
              ? m.comment_thread_card_creating_issue()
              : m.comment_thread_card_posting()}
          </span>
        )}
        {holdsDraft && (
          <span className="bg-surface text-ink-muted shrink-0 rounded-full px-1.5 py-px text-[11px]">
            {m.comment_thread_card_draft()}
          </span>
        )}
        {metadata.issue != null && (
          // A chip and not a button: the row is one 20px line box, and a card
          // that grew here would relay out the virtualized list. The card's
          // own click handler stands aside for a link.
          <a
            href={metadata.issue.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="bg-surface text-ink-muted hover:text-ink focus-visible:ring-accent inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[11px] tabular-nums focus-visible:ring-2 focus-visible:outline-none"
          >
            {m.comment_issue_number({ number: metadata.issue.number })}
            <IconArrowUpRight aria-hidden="true" size={10} />
          </a>
        )}
        <span className="text-ink-faint ml-auto shrink-0 text-[11px]">
          {m.comment_thread_card_click_to_open()}
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
          <ExpandedThread
            forge={forge}
            itemId={itemId}
            metadata={metadata}
            onClose={close}
            onDelete={onDelete}
            onReply={onReply}
            onResolveThread={onResolveThread}
            store={store}
          />
        </CommentExpansion>
      )}
    </div>
  );
}

/**
 * The whole thread, as the expanded layer reads it: the count and the delete
 * question, every message, and the reply box. This is what the card's overlay
 * shows.
 */
function ExpandedThread({
  forge,
  itemId,
  metadata,
  onClose,
  onDelete,
  onReply,
  onResolveThread,
  store,
}: CommentThreadCardProps & { onClose(): void }) {
  // True while the forge answers a Resolve or Unresolve press.
  const [resolving, setResolving] = useState(false);
  if (!isCommentThread(metadata)) return null;
  const comments: ThreadComment[] = metadata.comments;
  const root = comments[0];
  // The forge's own name, for the delete question and the link out.
  const forgeName = forgeLabel(forge);
  // GitHub files a reply under the thread of the comment it answers, so the
  // root has to exist there first. A draft is the forge's own, but a reply
  // written here posts at once — so a draft takes none.
  const staged = metadata.staged === true;
  const canReply = !staged && (store === 'local' || root.remoteId != null);
  const canResolve = threadResolvable(metadata, onResolveThread);
  const threadResolved = metadata.resolved === true;
  // A write on the wire holds Delete back: the row it would remove has not
  // reached its final state, and removing it is how a comment ends up on the
  // forge with no card here. The press comes back when the write settles.
  const deleteBlocked = threadWritePending(metadata);
  // Named only where the comment is actually there. A browser store holds a
  // local one, and asking a reviewer to confirm deleting something on the
  // forge that was never there is the wrong sentence in the one place it
  // matters most.
  const deleteQuestion = staged
    ? m.comment_thread_card_take_this_draft_comment_out_of_the_review()
    : store === 'forge'
      ? m.thread_delete_confirmation_forge({
          forge: forgeName,
          count: comments.length,
        })
      : m.thread_delete_local_confirmation({ count: comments.length });
  const issue = metadata.issue;

  return (
    <>
      {/*
        No picture on this row. It is the panel's own chrome, and every
        message under it already carries the picture of whoever wrote it —
        one beside "4 comments" would name only the first of the four.
      */}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-ink text-sm font-semibold">
          {comments.length === 1
            ? root.author
            : m.common_comment_count({ count: comments.length })}
        </span>
        {metadata.resolved === true && (
          <span className="bg-surface text-ink-faint border-line shrink-0 rounded-full border px-1.5 py-px text-[10px]">
            {m.comment_thread_card_resolved()}
          </span>
        )}
        {issue != null && (
          <a
            href={issue.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonClass({
              className: 'ml-auto',
              size: 'sm',
              variant: 'outline',
            })}
          >
            {m.comment_open_issue({ number: issue.number })}
            <IconArrowUpRight aria-hidden="true" size={12} />
          </a>
        )}
        {canResolve && (
          <Button
            variant="outline"
            size="sm"
            className={issue == null ? 'ml-auto' : undefined}
            disabled={resolving}
            onClick={() => {
              if (onResolveThread == null) return;
              setResolving(true);
              void onResolveThread(
                itemId,
                metadata.key,
                !threadResolved
              ).finally(() => setResolving(false));
            }}
          >
            {resolving
              ? threadResolved
                ? m.comment_thread_card_unresolving()
                : m.comment_thread_card_resolving()
              : threadResolved
                ? m.comment_thread_card_unresolve()
                : m.comment_thread_card_resolve_thread()}
          </Button>
        )}
        {deleteBlocked ? (
          <Tooltip label={DELETE_BLOCKED_TIP()} side="top-end" wide>
            <Button
              aria-label={m.review_submit_dialog_label({
                label: m.comment_thread_card_delete(),
                tip: DELETE_BLOCKED_TIP(),
              })}
              className={canResolve || issue != null ? undefined : 'ml-auto'}
              disabled
              size="sm"
              variant="danger"
            >
              {m.comment_thread_card_delete()}
            </Button>
          </Tooltip>
        ) : (
          <ConfirmInline
            className={canResolve || issue != null ? undefined : 'ml-auto'}
            label={m.comment_thread_card_delete()}
            question={deleteQuestion}
            confirmLabel={m.comment_thread_card_delete()}
            onConfirm={() => {
              onClose();
              onDelete(itemId, metadata.key);
            }}
          />
        )}
        <Button variant="outline" size="sm" onClick={onClose}>
          {m.comment_thread_card_close()}
        </Button>
      </div>

      <ol className="font-sans">
        {comments.map((comment, index) => (
          <li
            key={comment.key}
            className={cn(index > 0 && 'border-line mt-2.5 border-t pt-2.5')}
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
              {comment.staged === true && (
                <span className="bg-surface text-ink-muted shrink-0 rounded-full px-1.5 py-px text-[11px]">
                  {m.comment_thread_card_draft()}
                </span>
              )}
              {/* A draft reply comes out on its own, so the published
                  messages around it are never deleted to drop it. */}
              {comment.staged === true && !staged && !deleteBlocked && (
                <ConfirmInline
                  label={m.comment_thread_card_delete()}
                  question={m.comment_thread_card_take_this_draft_comment_out_of_the_review()}
                  confirmLabel={m.comment_thread_card_delete()}
                  onConfirm={() => onDelete(itemId, comment.key)}
                />
              )}
              {comment.htmlUrl != null && (
                <a
                  href={comment.htmlUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-ink-faint hover:text-accent ml-auto text-[11px] underline"
                >
                  {m.comment_thread_card_on_forge({ forge: forgeName })}
                </a>
              )}
            </div>
            <CommentBody body={comment.body} />
          </li>
        ))}
      </ol>

      {canReply ? (
        <ReplyForm
          forge={forge}
          onSubmit={(body) => onReply(itemId, metadata.key, body)}
          pending={metadata.pending === true}
          store={store}
        />
      ) : (
        <p className="border-line text-ink-faint mt-3 border-t pt-3 text-[11px]">
          {staged
            ? m.comment_thread_card_this_comment_is_a_draft_it_goes_up()
            : m.comment_thread_card_this_comment_has_not_reached_forge_yet({
                forge: forgeName,
              })}
        </p>
      )}
    </>
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
  forge,
  onSubmit,
  pending,
  store,
}: {
  forge: ForgeName;
  onSubmit(body: string): void;
  pending: boolean;
  store: CommentStore;
}) {
  const [body, setBody] = useState('');
  const canSend = body.trim().length > 0 && !pending;
  const forgeName = forgeLabel(forge);

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
        dir="auto"
        value={body}
        rows={2}
        placeholder={
          store === 'forge'
            ? m.comment_thread_card_reply_on_forge({ forge: forgeName })
            : m.comment_thread_card_reply_in_this_browser()
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
          {pending
            ? m.comment_thread_card_sending()
            : m.comment_thread_card_reply()}
        </Button>
        <span className="text-ink-faint ml-auto text-[11px]">
          {m.comment_thread_card_cmd_or_ctrl_with_enter()}
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
