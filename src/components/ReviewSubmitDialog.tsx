import { IconXSquircle } from '@pierre/icons';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import type { SubmitReviewState } from '@/hooks/useSubmitReview';
import { cn } from '@/lib/cn';
import {
  describeSubmittedReview,
  type ReviewBlock,
  reviewBlock,
  REVIEW_EVENTS,
  type ReviewEvent,
} from '@/lib/reviewDecision';

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
  if (block === 'needs-note') return 'Add a note. GitHub needs one.';
  return event === 'APPROVE'
    ? 'GitHub refuses an approval on your own pull request.'
    : 'GitHub refuses requested changes on your own pull request.';
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
  const { error, latest, pending, reset, submit, submitted } = review;

  // A popover opening again is a new verdict. The words of the last one, and the
  // failure of the one before that, belong to a decision already made.
  useEffect(() => {
    if (!open) return;
    setBody('');
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
    ? 'You can comment on your own pull request. GitHub allows nothing else.'
    : needsNote
      ? 'Add a note. GitHub needs one to request changes or comment.'
      : undefined;

  return (
    <div
      ref={popoverRef}
      id={id}
      popover="auto"
      role="dialog"
      aria-label="Submit a review"
      className="border-line bg-raised text-ink fixed m-0 overflow-y-auto overscroll-contain rounded-xl border p-0 shadow-lg"
      onBeforeToggle={(event) => {
        if (event.newState === 'open') positionPopover();
      }}
      onToggle={(event) => onOpenChange(event.newState === 'open')}
    >
      <div className="border-line flex items-center gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">Submit a review</h2>
        <Button
          aria-label="Close"
          className="ml-auto"
          size="icon-sm"
          variant="quiet"
          onClick={onClose}
        >
          <IconXSquircle size={14} />
        </Button>
      </div>
      <div className="p-3">
        <p className="text-ink-muted text-xs">
          This is a review of the whole pull request for{' '}
          <span className="text-ink font-medium">{targetLabel}</span>. Line
          comments are posted where you write them.
        </p>

        {/* Why the button that opened this says `Approved` rather than `Review`.
          GitHub keeps every review and follows the newest, so a second one is
          the way to change a decision rather than a duplicate of it. */}
        {latest != null && (
          <p className="text-ink-muted mt-2 text-xs">
            {describeSubmittedReview(latest)} A new one takes its place.
          </p>
        )}

        {/* Leave focus on the trigger when opening. Touch fields use 16px
            text to avoid Safari focus zoom, including landscape iPhones. */}
        <textarea
          aria-label="Review body"
          className={cn(
            'border-line bg-canvas text-ink placeholder:text-ink-faint focus-visible:border-accent',
            'mt-2 w-full resize-y rounded-md border p-2 text-sm [@media(pointer:coarse)]:text-base focus-visible:outline-none'
          )}
          disabled={busy}
          placeholder="Leave a note with your review"
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
