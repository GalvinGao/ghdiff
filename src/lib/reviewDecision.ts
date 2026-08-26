// Submitting a review: the three verdicts GitHub takes, and the one rule that
// separates them.
//
// GitHub calls these `event` on `POST /pulls/{n}/reviews`, and the names are
// its own — the API takes `APPROVE`, not `approve`, and nothing here translates
// them. A review submitted from ghdiff is a standalone review: the line
// comments this app writes are posted as they are written, so there is never a
// pending batch for a verdict to carry.

/** GitHub's `event`, verbatim. */
export type ReviewEvent = 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES';

export interface ReviewEventSpec {
  event: ReviewEvent;
  /** What the button says. */
  label: string;
  /** What it says while GitHub is deciding. */
  pendingLabel: string;
  /**
   * GitHub answers 422 to a `REQUEST_CHANGES` or a `COMMENT` with no body, and
   * it is right to: a verdict that asks for work, or one that is only a remark,
   * is nothing at all without the words. An approval needs none.
   */
  requiresBody: boolean;
  /** The verdict in `state`, once GitHub has recorded it. */
  submittedState: string;
}

export const REVIEW_EVENTS: readonly ReviewEventSpec[] = [
  {
    event: 'APPROVE',
    label: 'Approve',
    pendingLabel: 'Approving…',
    requiresBody: false,
    submittedState: 'APPROVED',
  },
  {
    event: 'REQUEST_CHANGES',
    label: 'Request changes',
    pendingLabel: 'Requesting…',
    requiresBody: true,
    submittedState: 'CHANGES_REQUESTED',
  },
  {
    event: 'COMMENT',
    label: 'Comment',
    pendingLabel: 'Commenting…',
    requiresBody: true,
    submittedState: 'COMMENTED',
  },
];

export function reviewEventSpec(event: ReviewEvent): ReviewEventSpec {
  const spec = REVIEW_EVENTS.find((candidate) => candidate.event === event);
  // The list above is exhaustive over the union, so this is unreachable. It is
  // here so the return type is not a lie to every caller.
  if (spec == null) throw new Error(`Unknown review event: ${event}`);
  return spec;
}

/**
 * Whether this verdict can be sent with this body. The dialog asks before it
 * enables a button, so the reviewer is told by a disabled button rather than by
 * a 422 that arrives after they have committed to the words.
 */
export function canSubmitReview(event: ReviewEvent, body: string): boolean {
  return !reviewEventSpec(event).requiresBody || body.trim().length > 0;
}

/** What GitHub answers with, and what the app keeps of it. */
export interface SubmittedReview {
  id: number;
  /** `APPROVED`, `CHANGES_REQUESTED` or `COMMENTED`. */
  state: string;
  submittedAt?: string;
  htmlUrl?: string;
}

/** The line the header shows after a verdict lands. */
export function describeSubmittedReview(review: SubmittedReview): string {
  switch (review.state) {
    case 'APPROVED':
      return 'You approved this pull request.';
    case 'CHANGES_REQUESTED':
      return 'You requested changes on this pull request.';
    case 'COMMENTED':
      return 'You commented on this pull request.';
    default:
      // GitHub has states this app does not offer, `DISMISSED` among them, and
      // a review read back in one of them is still a review that landed.
      return 'GitHub recorded your review.';
  }
}
