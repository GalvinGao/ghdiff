import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import type { SubmitReviewState } from '@/hooks/useSubmitReview';
import { cn } from '@/lib/cn';
import {
  canSubmitReview,
  describeSubmittedReview,
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

export function ReviewSubmitDialog({
  onClose,
  onSubmitted,
  open,
  review,
  targetLabel,
}: {
  onClose(): void;
  /** Called once GitHub has recorded a verdict, so the caller can reload. */
  onSubmitted?(): void;
  open: boolean;
  review: SubmitReviewState;
  /** `owner/repo #number`, so the dialog says what it is about to decide. */
  targetLabel: string;
}) {
  const [body, setBody] = useState('');
  const { error, pending, reset, submit, submitted } = review;

  // A dialog opening again is a new verdict. The words of the last one, and the
  // failure of the one before that, belong to a decision already made.
  useEffect(() => {
    if (!open) return;
    setBody('');
    reset();
  }, [open, reset]);

  const busy = pending != null;

  return (
    <Dialog onClose={onClose} open={open} title="Submit a review">
      <p className="text-ink-muted text-xs">
        On <span className="text-ink font-medium">{targetLabel}</span>. This is
        a review of the whole pull request. A comment on a line is posted where
        you write it.
      </p>

      <textarea
        aria-label="Review body"
        className={cn(
          'border-line bg-canvas text-ink placeholder:text-ink-faint focus-visible:border-accent',
          'mt-2 w-full resize-y rounded-md border p-2 text-sm focus-visible:outline-none'
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

      {/* Approve is last, on the right, where the affirming button goes. The
          note above it is the reason the other two are disabled, so it is only
          there while they are. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!canSubmitReview('COMMENT', body) && (
          <p className="text-ink-faint text-xs">
            A note is required to request changes or to comment.
          </p>
        )}
        <div className="ml-auto flex items-center gap-2">
          {[...REVIEW_EVENTS].reverse().map((spec) => (
            <Button
              key={spec.event}
              disabled={busy || !canSubmitReview(spec.event, body)}
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
          ))}
        </div>
      </div>
    </Dialog>
  );
}
