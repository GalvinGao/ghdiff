// Submitting a review: the three verdicts GitHub takes, and the one rule that
// separates them.
//
// GitHub calls these `event` on `POST /pulls/{n}/reviews`, and the names are
// its own — the API takes `APPROVE`, not `approve`, and nothing here translates
// them. A review submitted from ghdiff is a standalone review: the line
// comments this app writes are posted as they are written, so there is never a
// pending batch for a verdict to carry.

import type { StatusTone } from './pullStatus.ts';

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
  /**
   * Whether GitHub takes this verdict from the person who opened the pull
   * request. It takes a comment and refuses the other two, and it answers a
   * refusal with 422 — so this is what keeps the button from offering something
   * GitHub will not do.
   */
  allowedOnOwn: boolean;
  /** The verdict in `state`, once GitHub has recorded it. */
  submittedState: string;
}

export const REVIEW_EVENTS: readonly ReviewEventSpec[] = [
  {
    event: 'APPROVE',
    label: 'Approve',
    pendingLabel: 'Approving…',
    requiresBody: false,
    allowedOnOwn: false,
    submittedState: 'APPROVED',
  },
  {
    event: 'REQUEST_CHANGES',
    label: 'Request changes',
    pendingLabel: 'Requesting…',
    requiresBody: true,
    allowedOnOwn: false,
    submittedState: 'CHANGES_REQUESTED',
  },
  {
    event: 'COMMENT',
    label: 'Comment',
    pendingLabel: 'Commenting…',
    requiresBody: true,
    allowedOnOwn: true,
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
 * Why a verdict cannot be sent, when it cannot.
 *
 * Two things stop one, and they are not the same kind of thing. A missing note
 * is the reviewer's to fix and clears the moment they type. Their own pull
 * request never clears — GitHub refuses an approval and a change request from
 * the person who opened it, whatever they write.
 *
 * `own-pull-request` is asked first for exactly that reason: on your own pull
 * request, `Approve` and `Request changes` are gone whether or not there is a
 * note, so reporting the note would send a reviewer to write one that changes
 * nothing. `Comment` is the one verdict GitHub does take on your own, so it
 * falls through to the note rule like any other.
 *
 * This replaced a boolean. The boolean was enough to disable a button and not
 * enough to say why, and a control that is grey for an unstated reason is a
 * control a reviewer argues with. It also let the second rule go unwritten
 * until GitHub answered a self-approval with a bare "Unprocessable Entity".
 */
/**
 * Whether the reviewer is the one who opened this pull request.
 *
 * GitHub compares logins without case, so this does too. Either side missing
 * answers no, and that default is the safe one: it leaves all three verdicts
 * offered and lets GitHub be the authority, where guessing yes would grey out
 * two buttons on somebody else's pull request for no reason a reviewer could
 * see.
 */
export function isOwnPullRequest(
  author: string | undefined,
  viewer: string | undefined
): boolean {
  if (author == null || viewer == null) return false;
  return author.toLowerCase() === viewer.toLowerCase();
}

export type ReviewBlock = 'needs-note' | 'own-pull-request';

export function reviewBlock(input: {
  body: string;
  event: ReviewEvent;
  /** Whether the reviewer is the one who opened this pull request. */
  ownPullRequest: boolean;
}): ReviewBlock | undefined {
  const spec = reviewEventSpec(input.event);
  if (input.ownPullRequest && !spec.allowedOnOwn) return 'own-pull-request';
  if (spec.requiresBody && input.body.trim().length === 0) return 'needs-note';
  return undefined;
}

/**
 * Whether this verdict can be sent. A thin reading of `reviewBlock`, for the
 * callers that only need the yes or no.
 */
export function canSubmitReview(
  event: ReviewEvent,
  body: string,
  ownPullRequest = false
): boolean {
  return reviewBlock({ body, event, ownPullRequest }) == null;
}

/**
 * A verdict already on record, narrowed to the three that still stand. The
 * vocabulary is `ReviewState`'s, plus the one axis a pull request's own
 * `reviewDecision` never carries: a review that is only a remark.
 */
export type ReviewVerdict = 'approved' | 'changes' | 'commented';

export interface ReviewVerdictSpec {
  verdict: ReviewVerdict;
  /** What the header's button says once this verdict is on record. */
  label: string;
  /**
   * The colour, in the vocabulary the status square paints with. The square in
   * the left bar and this button answer the same question about the same pull
   * request, so green there and green here have to mean one thing.
   */
  tone: StatusTone;
}

const VERDICTS: Record<string, ReviewVerdictSpec> = {
  APPROVED: { verdict: 'approved', label: 'Approved', tone: 'success' },
  CHANGES_REQUESTED: {
    verdict: 'changes',
    label: 'Changes requested',
    tone: 'failure',
  },
  COMMENTED: { verdict: 'commented', label: 'Commented', tone: 'neutral' },
};

/**
 * The verdict a recorded review stands for, or nothing when it stands for none.
 *
 * GitHub has two states that are not verdicts and this reads both as nothing.
 * `PENDING` is a review the reviewer started on github.com and has not sent, so
 * there is no decision to report. `DISMISSED` is one GitHub has taken back, so
 * the decision it held no longer counts.
 */
export function reviewVerdict(
  review: SubmittedReview | undefined
): ReviewVerdictSpec | undefined {
  if (review == null) return undefined;
  return VERDICTS[review.state];
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

/**
 * A verdict somebody else left on this pull request, for the top of the review
 * dialog. A reviewer about to decide is helped most by what the rest of the
 * team has already decided, and that is otherwise a trip to github.com.
 */
export interface TeamReview {
  id: number;
  author: string;
  authorAvatarUrl?: string;
  /** `APPROVED`, `CHANGES_REQUESTED` or `COMMENTED`. */
  state: string;
  /** GitHub's plain-text rendering of the body, markdown already stripped. */
  body: string;
  /** Line comments the review carried with it. */
  commentCount: number;
  submittedAt?: string;
  htmlUrl?: string;
}

/** A review as the GraphQL `reviews` connection answers it. */
export interface TeamReviewSource {
  databaseId?: number | null;
  state?: string | null;
  submittedAt?: string | null;
  url?: string | null;
  bodyText?: string | null;
  viewerDidAuthor?: boolean | null;
  author?: {
    /** `__typename`, aliased: `User`, `Bot`, `Mannequin` and the rest. */
    kind?: string | null;
    login?: string | null;
    avatarUrl?: string | null;
  } | null;
  comments?: { totalCount?: number | null } | null;
}

/** How many the dialog lists. Past that it is a history, not a glance. */
export const MAX_TEAM_REVIEWS = 5;

/**
 * The newest verdicts left by other people, newest first.
 *
 * Four kinds of review are not that. The viewer's own is already the line
 * under the title. A bot's is not a team member's decision. `PENDING` and
 * `DISMISSED` are not decisions at all, the way `reviewVerdict` reads them.
 * And a `COMMENTED` review with no body is how GitHub files a reply in a line
 * thread: its words are on the line in the diff already, and a busy thread
 * would otherwise push every verdict off the list.
 */
export function recentTeamReviews(
  nodes: readonly (TeamReviewSource | null | undefined)[],
  limit = MAX_TEAM_REVIEWS
): TeamReview[] {
  const reviews: TeamReview[] = [];
  for (const node of nodes) {
    if (node == null || typeof node.databaseId !== 'number') continue;
    const state = node.state ?? '';
    if (VERDICTS[state] == null) continue;
    if (node.viewerDidAuthor === true) continue;
    if (node.author?.kind === 'Bot') continue;
    const body = node.bodyText?.trim() ?? '';
    if (state === 'COMMENTED' && body.length === 0) continue;
    reviews.push({
      id: node.databaseId,
      author: node.author?.login ?? 'ghost',
      authorAvatarUrl: node.author?.avatarUrl ?? undefined,
      state,
      body,
      commentCount: node.comments?.totalCount ?? 0,
      submittedAt: node.submittedAt ?? undefined,
      htmlUrl: node.url ?? undefined,
    });
  }
  // GitHub answers oldest first. A review with no time sorts last rather than
  // first, since nothing says it is recent.
  reviews.sort((a, b) => time(b.submittedAt) - time(a.submittedAt));
  return reviews.slice(0, limit);
}

function time(iso: string | undefined): number {
  const value = iso == null ? Number.NaN : Date.parse(iso);
  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
}
