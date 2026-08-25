import { isRateLimited } from './rateLimit.ts';

// What the review panel says, and which button it offers, when the diff does
// not arrive.
//
// A rate limit is the one failure the reviewer can fix in the moment, and the
// fix is not the one the panel used to offer. "Try again" against a spent
// anonymous quota does nothing for the rest of the hour, while a token raises
// the ceiling from 60 requests to 5000 and takes effect on the next request.
// So a rate-limited browser with no token is asked for one, and "Try again"
// steps back to being the second button on the row.
//
// A token that is itself over quota gets "Try again" and nothing else: there is
// no second token to add, and the wait is all that is left.

/** Which button the panel leads with. */
export type ReviewFailureAction = 'add-token' | 'retry';

export interface ReviewFailure {
  action: ReviewFailureAction;
  message: string;
  title: string;
}

const FALLBACK_MESSAGE = 'The request for this diff did not come back.';

export function describeReviewFailure(input: {
  hasToken: boolean;
  /** What the server said, when it said anything. */
  message?: string;
  /** The status the request failed with. Absent for a network failure. */
  status?: number;
}): ReviewFailure {
  const { hasToken, message, status } = input;

  if (isRateLimited(status)) {
    // GitHub's own body names an address and recommends authentication, which
    // is the right advice in the wrong voice: this panel can offer the button
    // instead of describing it. So the copy here replaces it.
    return hasToken
      ? {
          action: 'retry',
          message:
            "This token's hourly quota is spent. GitHub refills it within the hour.",
          title: 'GitHub is rate limiting this token',
        }
      : {
          action: 'add-token',
          message:
            'GitHub gives one small hourly quota to every unauthenticated address, and this one is spent. A personal access token carries a quota of its own, and a much larger one.',
          title: 'GitHub is rate limiting this browser',
        };
  }

  return {
    action: 'retry',
    message: message ?? FALLBACK_MESSAGE,
    title: 'Could not load that diff',
  };
}
