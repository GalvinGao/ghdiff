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
//
// Not Found is the other failure with a fix, and it is the one that does not
// look like it has one. GitHub answers 404 for a diff that is not there and for
// a diff the caller is not allowed to see, on purpose: an answer that
// distinguished them would confirm that a private repository exists. So "Not
// Found" on a repository the reviewer knows is there means, almost always,
// that the request could not prove who was asking — and that is a token.

/**
 * Which button the panel leads with. `add-token` opens the token dialog, and
 * the panel words it for whether there is a token there already: the reviewer
 * a 404 sends there usually has one that cannot reach this repository.
 */
export type ReviewFailureAction = 'add-token' | 'retry';

export interface ReviewFailure {
  action: ReviewFailureAction;
  message: string;
  title: string;
}

const FALLBACK_MESSAGE = 'The request for this diff did not come back.';

const NOT_FOUND = 404;

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

  if (status === NOT_FOUND) {
    // GitHub's own body is the single word "Not Found", which is true and
    // useless. What the reviewer needs is the reason it is the same word for
    // both cases, and the one thing they can do about it.
    return hasToken
      ? {
          action: 'add-token',
          message:
            'GitHub answers the same way for a diff that is not there and for one this token cannot read. A fine-grained token has to list this repository, and an organization that requires SSO has to authorize the token as well.',
          title: "Not found, or out of this token's reach",
        }
      : {
          action: 'add-token',
          message:
            'GitHub answers the same way for a diff that is not there and for one this browser is not allowed to see, so a private repository looks like this. A personal access token with access to it tells the two apart.',
          title: 'Not found, or private',
        };
  }

  return {
    action: 'retry',
    message: message ?? FALLBACK_MESSAGE,
    title: 'Could not load that diff',
  };
}
