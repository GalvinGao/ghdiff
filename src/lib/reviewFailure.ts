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

const FALLBACK_MESSAGE =
  "The server didn't respond. Your connection might be offline, or the request timed out.";

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
            'Your token ran out of GitHub requests for the hour. Wait a bit for it to refill, then try again.',
          title: "You've hit your token limit",
        }
      : {
          action: 'add-token',
          message:
            'GitHub limits requests without a token to 60 per hour. Add a token to get 5,000 requests per hour.',
          title: "You've hit GitHub's rate limit",
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
            'Your token might not include this repo, or it may need SAML authorization. Try updating your token.',
          title: 'Check your token permissions',
        }
      : {
          action: 'add-token',
          message:
            "If this repo is private, GitHub won't show it without a personal access token. Add a token to view the diff.",
          title: 'This repository might be private',
        };
  }

  return {
    action: 'retry',
    message: message ?? FALLBACK_MESSAGE,
    title: 'Could not load the diff',
  };
}
