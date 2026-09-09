import { ParaglideMessage } from '@inlang/paraglide-js-react';
import { IconXSquircle } from '@pierre/icons';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { m } from '../paraglide/messages.js';
import { AuthorAvatar } from '@/components/AuthorAvatar';
import { VERDICT_COLOR, VERDICT_ICON } from '@/components/reviewVerdictStyle';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import type { SubmitReviewState } from '@/hooks/useSubmitReview';
import { cn } from '@/lib/cn';
import { describeAge } from '@/lib/pullDetails';
import {
  describeSubmittedReview,
  type ReviewBlock,
  reviewBlock,
  REVIEW_EVENTS,
  type ReviewEvent,
  reviewVerdict,
  type TeamReview,
} from '@/lib/reviewDecision';

const reviewMarkup = {
  strong: ({ children }: { children?: ReactNode }) => (
    <span className="text-ink font-medium">{children}</span>
  ),
};

// The verdict on the pull request as a whole.
//
// Three buttons and no radio group: each one says what it does and does it, so
// a verdict is one press rather than a choice and then a confirmation. GitHub's
// own form asks twice because it also has a batch of pending line comments to
// send; this app posts a line comment as it is written, so there is nothing
// waiting here for a verdict to carry, and nothing to confirm.
//
// Approve is the one filled control, because it is the answer a reviewer gives
// most and the app's accent is ink rather than a colour. Request changes is the
// only red thing on screen, which is the weight it has on GitHub.

const VARIANT: Record<ReviewEvent, 'danger' | 'outline' | 'solid'> = {
  APPROVE: 'solid',
  REQUEST_CHANGES: 'danger',
  COMMENT: 'outline',
};

/**
 * Why this button is grey, in the words that go on its tooltip.
 *
 * A missing note reads the same on either button that needs one. Ownership does
 * not: "GitHub refuses an approval" and "GitHub refuses requested changes" are
 * different sentences about different verdicts, and a reviewer reading one
 * should not have to work out which of the two they pressed.
 */
function blockTip(event: ReviewEvent, block: ReviewBlock): string {
  if (block === 'needs-note')
    return m.review_submit_dialog_add_a_note_github_needs_one();
  return event === 'APPROVE'
    ? m.review_submit_dialog_github_refuses_an_approval_on_your_own_pull()
    : m.review_submit_dialog_github_refuses_requested_changes_on_your_own_pull();
}

export function ReviewSubmitDialog({
  id,
  onOpenChange,
  onClose,
  onSubmitted,
  open,
  ownPullRequest,
  review,
  targetLabel,
}: {
  id: string;
  onOpenChange(open: boolean): void;
  onClose(): void;
  /** Called once GitHub has recorded a verdict, so the caller can reload. */
  onSubmitted?(): void;
  open: boolean;
  /**
   * Whether the reviewer opened this pull request. GitHub takes a comment from
   * them and refuses the other two, so two of the three buttons are gone — and
   * a 422 after the words are written is what this replaces.
   */
  ownPullRequest: boolean;
  review: SubmitReviewState;
  /** `owner/repo #number`, so the dialog says what it is about to decide. */
  targetLabel: string;
}) {
  const [body, setBody] = useState('');
  // Stamped when the popover opens, so every age in the team's list is read
  // from one instant and no clock runs behind a closed popover. The rows do
  // not wait for it: the list is drawn with the popover's first paint, and the
  // ages arrive at the right edge of their rows, where nothing moves for them.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Follow the visual viewport when the iPhone keyboard shrinks or pans it.
  const positionPopover = useCallback(() => {
    const element = popoverRef.current;
    const trigger = document.getElementById(`${id}-trigger`);
    if (!element || !trigger) return;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const anchor = trigger.getBoundingClientRect();
    const panelWidth = Math.min(480, width - 16);
    const panelTop = Math.max(
      top + 8,
      Math.min(anchor.bottom + 8, top + height - 160)
    );
    element.style.width = `${panelWidth}px`;
    element.style.left = `${Math.max(left + 8, Math.min(anchor.right - panelWidth, left + width - panelWidth - 8))}px`;
    element.style.top = `${panelTop}px`;
    element.style.maxHeight = `${Math.max(0, top + height - panelTop - 8)}px`;
  }, [id]);

  useEffect(() => {
    if (!open) {
      popoverRef.current?.hidePopover();
      return;
    }
    const viewport = window.visualViewport;
    window.addEventListener('resize', positionPopover);
    viewport?.addEventListener('resize', positionPopover);
    viewport?.addEventListener('scroll', positionPopover);
    return () => {
      window.removeEventListener('resize', positionPopover);
      viewport?.removeEventListener('resize', positionPopover);
      viewport?.removeEventListener('scroll', positionPopover);
    };
  }, [open, positionPopover]);
  const { error, latest, pending, reset, submit, submitted, team } = review;

  // A popover opening again is a new verdict. The words of the last one, and the
  // failure of the one before that, belong to a decision already made.
  useEffect(() => {
    if (!open) return;
    setBody('');
    setOpenedAt(Date.now());
    reset();
  }, [open, reset]);

  const busy = pending != null;

  // Whichever fact explains the grey buttons, and only one shows. Ownership
  // wins: on your own pull request it is the reason two of the three are gone,
  // and it is not a thing a reviewer can do anything about — where the note is.
  const needsNote = REVIEW_EVENTS.some(
    (spec) =>
      reviewBlock({ body, event: spec.event, ownPullRequest }) === 'needs-note'
  );
  const standingLine = ownPullRequest
    ? m.review_submit_dialog_you_can_comment_on_your_own_pull_request()
    : needsNote
      ? m.review_submit_dialog_add_a_note_github_needs_one_to_request()
      : undefined;

  return (
    <div
      ref={popoverRef}
      id={id}
      popover="auto"
      role="dialog"
      aria-label={m.review_submit_dialog_submit_a_review()}
      className="border-line bg-raised text-ink fixed m-0 overflow-y-auto overscroll-contain rounded-xl border p-0 shadow-lg"
      onBeforeToggle={(event) => {
        if (event.newState === 'open') positionPopover();
      }}
      onToggle={(event) => onOpenChange(event.newState === 'open')}
    >
      <div className="border-line flex items-center gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">
          {m.review_submit_dialog_submit_a_review()}
        </h2>
        <Button
          aria-label={m.dialog_close()}
          className="ml-auto"
          size="icon-sm"
          variant="quiet"
          onClick={onClose}
        >
          <IconXSquircle size={14} />
        </Button>
      </div>
      {/* What the rest of the team decided, above the reviewer's own verdict:
          it is the context for that verdict. Nothing is drawn when nobody
          else has reviewed, since an empty section is a promise of rows. */}
      {team.length > 0 && <TeamReviews now={openedAt} reviews={team} />}
      <div className="p-3">
        <p className="text-ink-muted text-xs">
          <ParaglideMessage
            message={m.review_submit_scope}
            inputs={{ target: targetLabel }}
            markup={reviewMarkup}
          />
        </p>

        {/* Why the button that opened this says `Approved` rather than `Review`.
          GitHub keeps every review and follows the newest, so a second one is
          the way to change a decision rather than a duplicate of it. */}
        {latest != null && (
          <p className="text-ink-muted mt-2 text-xs">
            {m.review_previous_verdict({
              verdict: describeSubmittedReview(latest),
            })}
          </p>
        )}

        {/* Touch fields use 16px text to avoid Safari focus zoom, including
            landscape iPhones. Native popover autofocus runs on each opening. */}
        <textarea
          autoFocus
          aria-label={m.review_submit_dialog_review_body()}
          className={cn(
            'border-line bg-canvas text-ink placeholder:text-ink-faint focus-visible:border-accent',
            'mt-2 w-full resize-y rounded-md border p-2 text-sm [@media(pointer:coarse)]:text-base focus-visible:outline-none'
          )}
          disabled={busy}
          placeholder={m.review_submit_dialog_leave_a_note_with_your_review()}
          rows={5}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />

        {error != null && (
          <p className="text-removed mt-2 text-xs" role="alert">
            {error}
          </p>
        )}
        {submitted != null && (
          <p className="text-ink-muted mt-2 text-xs" role="status">
            {describeSubmittedReview(submitted)}
          </p>
        )}

        {/* Approve is last, on the right, where the affirming button goes.

          The line to its left is the standing explanation, for the reviewer who
          never hovers: real text in the DOM, so a screen reader gets the reason
          as well. On your own pull request it names the one verdict that is
          available rather than dwelling on the two that are not — and Comment's
          own tooltip is what asks for the note, since a note is the only thing
          left that a reviewer can change. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {standingLine != null && (
            <p className="text-ink-faint text-xs">{standingLine}</p>
          )}
          <div className="ml-auto flex items-center gap-2">
            {[...REVIEW_EVENTS].reverse().map((spec) => {
              const block = reviewBlock({
                body,
                event: spec.event,
                ownPullRequest,
              });
              const tip =
                block == null ? undefined : blockTip(spec.event, block);
              const button = (
                <Button
                  // The reason joins the label rather than replacing it. The
                  // tooltip's own text is `aria-hidden`, so without this a screen
                  // reader is told the button is unavailable and never why.
                  aria-label={
                    tip == null ? undefined : `${spec.label} — ${tip}`
                  }
                  disabled={busy || block != null}
                  size="sm"
                  variant={VARIANT[spec.event]}
                  onClick={() => {
                    void (async () => {
                      const result = await submit(spec.event, body);
                      // A failure keeps the dialog open, with GitHub's reason in
                      // it and the words the reviewer wrote still in the box.
                      if (result == null) return;
                      onSubmitted?.();
                      onClose();
                    })();
                  }}
                >
                  {pending === spec.event ? spec.pendingLabel : spec.label}
                </Button>
              );
              // `Tooltip` hovers on its own wrapper, not on the control inside
              // it, which is what makes this work at all: `buttonClass` sets
              // `disabled:pointer-events-none`, so the pointer passes through a
              // disabled button and lands on the span around it.
              return tip == null ? (
                <span key={spec.event}>{button}</span>
              ) : (
                <Tooltip key={spec.event} label={tip} side="top-end" wide>
                  {button}
                </Tooltip>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** What a row says after the login, in the verdict's own words. */
const TEAM_VERDICT_WORDS: Record<string, string> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'requested changes',
  COMMENTED: 'commented',
};

function TeamReviews({
  now,
  reviews,
}: {
  now: number | null;
  reviews: TeamReview[];
}) {
  return (
    <section
      aria-label="Recent reviews from the team"
      className="border-line border-b px-3 py-2"
    >
      <h3 className="text-ink-faint text-xs">Recent reviews</h3>
      <ul className="-mx-1.5 mt-1 flex flex-col">
        {reviews.map((review) => (
          <li key={review.id}>
            <TeamReviewRow now={now} review={review} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TeamReviewRow({
  now,
  review,
}: {
  now: number | null;
  review: TeamReview;
}) {
  const verdict = reviewVerdict(review);
  const Icon = verdict == null ? undefined : VERDICT_ICON[verdict.verdict];
  const age =
    review.submittedAt == null || now == null
      ? ''
      : describeAge(review.submittedAt, now);
  const comments =
    review.commentCount === 0
      ? undefined
      : `${review.commentCount} line comment${review.commentCount === 1 ? '' : 's'}`;
  const content = (
    <>
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        <AuthorAvatar
          author={review.author}
          avatarUrl={review.authorAvatarUrl}
          size={16}
        />
        <span className="text-ink truncate font-medium">{review.author}</span>
        {Icon != null && verdict != null && (
          <Icon
            aria-hidden="true"
            className={cn('shrink-0', VERDICT_COLOR[verdict.tone])}
            size={12}
          />
        )}
        <span className="text-ink-muted shrink-0">
          {TEAM_VERDICT_WORDS[review.state] ?? 'reviewed'}
        </span>
        {age.length > 0 && (
          <span className="text-ink-faint ml-auto shrink-0 tabular-nums">
            {age}
          </span>
        )}
      </div>
      {/* The body is GitHub's plain-text rendering, so nothing in it can be
          markup. Two lines are enough to say what a verdict is about; the
          whole of it is one press away on GitHub. */}
      {(review.body.length > 0 || comments != null) && (
        <p className="text-ink-muted mt-0.5 line-clamp-2 pl-[22px] text-xs break-words">
          {review.body.length > 0 ? review.body : comments}
        </p>
      )}
    </>
  );
  const rowClass = 'block rounded-md px-1.5 py-1';
  // A new tab, like every other name here that GitHub has a page for: the
  // reviewer has a diff and a half-written verdict in this one.
  return review.htmlUrl == null ? (
    <div className={rowClass}>{content}</div>
  ) : (
    <a
      className={cn(
        rowClass,
        'hover:bg-surface focus-visible:ring-accent focus-visible:ring-1 focus-visible:outline-none'
      )}
      href={review.htmlUrl}
      rel="noreferrer"
      target="_blank"
      title={`Open ${review.author}'s review on GitHub`}
    >
      {content}
    </a>
  );
}
