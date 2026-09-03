import { isRateLimited } from './rateLimit.ts';

// What the review panel says, and which button it offers, when the diff does
// not arrive.
//
// Two actions, not three. There used to be one for "sign in" and one for
// "install", and they both now lead to `/setup` — the page that can tell those
// two apart, because it asks GitHub which of them is missing instead of guessing
// from a status code. So the panel offers one button and the wording is where the
// difference lives.
//
// A rate limit is the one failure a reviewer can fix in the moment, and the fix
// is not "Try again". Against a spent signed-out quota that does nothing for the
// rest of the hour, while signing in raises the ceiling from 60 requests to 5,000
// and takes effect on the next one. A signed-in reviewer over quota gets the
// retry alone: there is no second account to add, and the wait is all there is.
//
// Not Found is the other failure with a fix, and the one that does not look like
// it has one. GitHub answers 404 for a diff that is not there and for a diff the
// caller may not see, on purpose: an answer that told the two apart would confirm
// that a private repository exists. So the copy turns on whether the reviewer is
// signed in. Signed out, the likely cause is a private repository. Signed in, it
// is almost never the credential — that worked — and telling them to sign in
// again sends them to redo a step that already did what it could. It is the step
// a personal access token never had: a GitHub App reaches only the repositories
// it is installed on.
//
// Every line here was written by `agy -p` against this project's copy brief, not
// in the register of the comments around it.

/**
 * Which button the panel leads with. `setup` goes to `/setup`, carrying the path
 * the diff would not load from so that page can name the account.
 */
export type ReviewFailureAction = 'setup' | 'retry';

export interface ReviewFailure {
  action: ReviewFailureAction;
  message: string;
  title: string;
}

const FALLBACK_MESSAGE =
  "The server didn't respond. Your connection might be offline, or the request timed out.";

const NOT_FOUND = 404;

export function describeReviewFailure(input: {
  /** Whether GitHub answered for a credential on this browser's requests. */
  signedIn: boolean;
  /** What the server said, when it said anything. */
  message?: string;
  /** The status the request failed with. Absent for a network failure. */
  status?: number;
}): ReviewFailure {
  const { signedIn, message, status } = input;

  if (isRateLimited(status)) {
    // GitHub's own body names an address and recommends authentication, which
    // is the right advice in the wrong voice: this panel can offer the button
    // instead of describing it. So the copy here replaces it.
    return signedIn
      ? {
          action: 'retry',
          message:
            'You used all 5,000 GitHub requests for this hour. Wait a few minutes for your limit to reset, then try again.',
          title: 'Hourly GitHub rate limit reached',
        }
      : {
          action: 'setup',
          message:
            'GitHub limits unauthenticated requests to 60 per hour. Set up access to get 5,000 requests per hour immediately.',
          title: 'GitHub rate limit reached',
        };
  }

  if (status === NOT_FOUND) {
    // GitHub's own body is the single word "Not Found", which is true and
    // useless. What the reviewer needs is the reason it is the same word for
    // both cases, and the one thing they can do about it.
    return signedIn
      ? {
          action: 'setup',
          message:
            'GitHub returned Not Found because ghdiff is not installed on this repository or access is missing. Set up access to grant permission.',
          title: 'ghdiff needs access to this repository',
        }
      : {
          action: 'setup',
          message:
            'GitHub returns Not Found for private repositories when you are signed out. Set up access to view this diff.',
          title: 'Repository not found or private',
        };
  }

  return {
    action: 'retry',
    message: message ?? FALLBACK_MESSAGE,
    title: 'Could not load the diff',
  };
}
