import { m } from '../paraglide/messages.js';
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
  m.review_failure_the_server_didn_t_respond_your_connection_might;

const UNAUTHORIZED = 401;
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
          get message() {
            return m.review_failure_you_used_all_5_000_github_requests_for();
          },
          get title() {
            return m.review_failure_hourly_github_rate_limit_reached();
          },
        }
      : {
          action: 'setup',
          get message() {
            return m.review_failure_github_limits_unauthenticated_requests_to_60_per_hour();
          },
          get title() {
            return m.review_failure_github_rate_limit_reached();
          },
        };
  }

  if (status === UNAUTHORIZED) {
    // The Worker answers 401 for a cookie whose token is spent, and the browser
    // refreshes it and asks again before this panel sees the status. So a 401
    // that reaches here is a refresh that failed, and the session behind it is
    // gone — whatever `signedIn` still says, since that was read before it went.
    // The next step is the sign-in, and `/setup` is where that happens.
    return {
      action: 'setup',
      get message() {
        return m.review_failure_your_github_sign_in_is_no_longer_valid();
      },
      get title() {
        return m.review_failure_github_sign_in_expired();
      },
    };
  }

  if (status === NOT_FOUND) {
    // GitHub's own body is the single word "Not Found", which is true and
    // useless. What the reviewer needs is the reason it is the same word for
    // both cases, and the one thing they can do about it.
    return signedIn
      ? {
          action: 'setup',
          get message() {
            return m.review_failure_github_returned_not_found_because_ghdiff_is_not();
          },
          get title() {
            return m.review_failure_ghdiff_needs_access_to_this_repository();
          },
        }
      : {
          action: 'setup',
          get message() {
            return m.review_failure_github_returns_not_found_for_private_repositories_when();
          },
          get title() {
            return m.review_failure_repository_not_found_or_private();
          },
        };
  }

  return {
    action: 'retry',
    message: message ?? FALLBACK_MESSAGE(),
    get title() {
      return m.review_failure_could_not_load_the_diff();
    },
  };
}
