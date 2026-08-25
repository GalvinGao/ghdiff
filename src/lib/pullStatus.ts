// The two things a reviewer wants to know about an open pull request before
// they open it: has anybody reviewed it, and does it build.
//
// GalvinGao/floodgate paints those two axes into the browser tab's favicon: the
// left half is the review and the right half is the checks, and a "+" over the
// review half means the author pushed after somebody asked for changes. This
// module is that model, and `PullStatusMark` is that painting. The vocabulary is
// deliberately the same, so a colour means the same thing in the tab strip and
// in ghdiff's own list.

/** GitHub's `reviewDecision`, narrowed to the three outcomes worth a colour. */
export type ReviewState = 'approved' | 'changes' | 'none';

/** GitHub's `statusCheckRollup.state`, narrowed the same way. */
export type CheckState = 'success' | 'pending' | 'failure' | 'none';

export interface PullReviewStatus {
  review: ReviewState;
  check: CheckState;
  /**
   * True only when `review === 'changes'` and the head commit is newer than the
   * latest CHANGES_REQUESTED review, so the author has pushed since and the
   * request may already be answered. Absent otherwise, which keeps the common
   * status object down to two fields.
   */
  commitsSinceChanges?: boolean;
}

/** The shape the GraphQL pull request node contributes to a status. */
export interface PullStatusSource {
  reviewDecision?: string | null;
  headRefOid?: string | null;
  commits?: {
    nodes?:
      | ({
          commit?: {
            oid?: string | null;
            committedDate?: string | null;
            statusCheckRollup?: { state?: string | null } | null;
          } | null;
        } | null)[]
      | null;
  } | null;
  /** The latest CHANGES_REQUESTED review: `reviews(last: 1, states: [...])`. */
  reviews?: {
    nodes?: ({ submittedAt?: string | null } | null)[] | null;
  } | null;
}

const ROLLUP_CHECK: Record<string, CheckState> = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  ERROR: 'failure',
  PENDING: 'pending',
  EXPECTED: 'pending',
};

/**
 * Reads a status out of the GraphQL node. Every missing field maps to a defined
 * value, so a partial answer from GitHub still produces a status rather than an
 * exception.
 */
export function normalizePullStatus(
  source: PullStatusSource
): PullReviewStatus {
  const review: ReviewState =
    source.reviewDecision === 'APPROVED'
      ? 'approved'
      : source.reviewDecision === 'CHANGES_REQUESTED'
        ? 'changes'
        : 'none';

  // The rollup is only the truth about the branch if it belongs to the head
  // commit. A rollup on an older commit says nothing about what is there now.
  const commit = source.commits?.nodes?.[0]?.commit;
  const isHead =
    commit != null &&
    (source.headRefOid == null || commit.oid === source.headRefOid);
  const rollup = isHead ? commit?.statusCheckRollup?.state : undefined;
  // A null rollup is 'none' — the branch has no checks — which is not 'pending'.
  const check: CheckState = (rollup && ROLLUP_CHECK[rollup]) || 'none';

  const status: PullReviewStatus = { review, check };
  if (review === 'changes') {
    const requestedAt = Date.parse(
      source.reviews?.nodes?.[0]?.submittedAt ?? ''
    );
    const committedAt = Date.parse(commit?.committedDate ?? '');
    if (
      !Number.isNaN(requestedAt) &&
      !Number.isNaN(committedAt) &&
      committedAt > requestedAt
    ) {
      status.commitsSinceChanges = true;
    }
  }
  return status;
}

/** The four colours the mark paints with, as tokens rather than hexes. */
export type StatusTone = 'success' | 'pending' | 'failure' | 'neutral';

const REVIEW_TONE: Record<ReviewState, StatusTone> = {
  approved: 'success',
  changes: 'failure',
  none: 'neutral',
};

const CHECK_TONE: Record<CheckState, StatusTone> = {
  success: 'success',
  pending: 'pending',
  failure: 'failure',
  none: 'neutral',
};

export function reviewTone(review: ReviewState): StatusTone {
  return REVIEW_TONE[review];
}

export function checkTone(check: CheckState): StatusTone {
  return CHECK_TONE[check];
}

const REVIEW_LABEL: Record<ReviewState, string> = {
  approved: 'Approved',
  changes: 'Changes requested',
  none: 'No review yet',
};

const CHECK_LABEL: Record<CheckState, string> = {
  success: 'checks passing',
  pending: 'checks running',
  failure: 'a check failed',
  none: 'no checks',
};

/** The status in words, for the mark's title and its accessible name. */
export function describePullStatus(status: PullReviewStatus): string {
  const review =
    status.review === 'changes' && status.commitsSinceChanges === true
      ? 'Changes requested, new commits since'
      : REVIEW_LABEL[status.review];
  return `${review} · ${CHECK_LABEL[status.check]}`;
}
