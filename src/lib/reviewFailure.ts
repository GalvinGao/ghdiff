import type { FailureMeta, FailureReason } from './failure';
import { isRateLimited } from './rateLimit';
import { m } from '@/paraglide/messages.js';

// What the review panel says, and which button it offers, when the diff does
// not arrive.
//
// The panel decides by the typed reason the server attached when there is one
// — the `x-ghdiff-failure` header on the plain routes' answers, the RPC
// error's data — because a status alone cannot say which failures the reviewer
// can act on: GitHub answers 404 for a missing diff and an invisible one alike,
// and a GitLab 401 is the instance asking for an account only when the caller
// is anonymous, while a connected grant that died is `auth-expired` and wants
// the reconnect instead. An answer that carries no reason falls back to the
// status reading, which is where callers that never learned the header keep
// working.
//
// Three actions. `setup` leads to `/setup` — the page that can tell a missing
// sign-in from a missing installation apart, because it asks GitHub which of
// them is missing instead of guessing from a status code. Both of those
// failures arrive as `setup`, and the wording is where the difference lives.
// `connect` opens the GitLab connect dialog on the target's own host, and
// `retry` is the offer when there is nothing to grant. A deployment with no
// GitHub App has no setup to offer at all: `githubOAuth: false` turns those
// actions into `retry` and the copy drops its setup clause, rather than send
// a reviewer down a path that ends in a 501.
//
// A rate limit is the one failure a reviewer can fix in the moment, and the fix
// is not "Try again". Against a spent signed-out quota that does nothing for
// the rest of the hour, while signing in raises the ceiling from 60 requests to
// 5,000 and takes effect on the next one. A signed-in reviewer over quota gets
// the retry alone: there is no second account to add, and the wait is all there is.
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
 * the diff would not load from so that page can name the account. `connect`
 * opens the GitLab connect dialog on the target's own host.
 */
export type ReviewFailureAction = 'setup' | 'retry' | 'connect';

export interface ReviewFailure {
  action: ReviewFailureAction;
  message: string;
  title: string;
}

const FALLBACK_MESSAGE =
  m.review_failure_the_server_didn_t_respond_your_connection_might;

const UNAUTHORIZED = 401;
const NOT_FOUND = 404;

/** The fallback panel: nothing to grant, nothing to connect — just try again. */
function couldNotLoadDiff(message?: string): ReviewFailure {
  return {
    action: 'retry',
    message: message ?? FALLBACK_MESSAGE(),
    get title() {
      return m.review_failure_could_not_load_the_diff();
    },
  };
}

export function describeReviewFailure(input: {
  /** Whether GitHub answered for a credential on this browser's requests. */
  signedIn: boolean;
  /** What the server said, when it said anything. */
  message?: string;
  /** The status the request failed with. Absent for a network failure. */
  status?: number;
  /** Which forge the target is on. Defaults to GitHub's wording. */
  forge?: 'github' | 'gitlab';
  /** Whether this browser holds a grant for the target's own GitLab host. */
  gitlabConnected?: boolean;
  /**
   * Whether this deployment offers GitHub sign-in. When it does not, every
   * GitHub failure that would offer `/setup` degrades to the retry: the cause
   * stays, the path that would 501 goes.
   */
  githubOAuth?: boolean;
  /**
   * The typed failure the server attached, read from the response's
   * `x-ghdiff-failure` header or the RPC error's data. When present it decides
   * the panel; `status` is only the fallback for answers that carry none.
   */
  failure?: FailureMeta | null;
}): ReviewFailure {
  const forge = input.forge ?? input.failure?.forge ?? 'github';
  const reason = input.failure?.reason;
  if (reason != null) {
    return describeByReason(input, forge, reason);
  }
  if (forge === 'gitlab') {
    return gitLabByStatus(input, input.status);
  }
  return gitHubByStatus(input, input.status);
}

/** The panel for a failure the server typed. One branch per reason. */
function describeByReason(
  input: {
    signedIn: boolean;
    message?: string;
    gitlabConnected?: boolean;
    githubOAuth?: boolean;
  },
  forge: 'github' | 'gitlab',
  reason: FailureReason
): ReviewFailure {
  const githubOAuth = input.githubOAuth ?? true;
  switch (reason) {
    case 'not-served':
      // The forge gate's own sentence says what this deployment serves, and
      // there is nothing the reviewer can grant that changes it.
      return couldNotLoadDiff(input.message);
    case 'auth-expired':
      return forge === 'gitlab'
        ? gitLabAuthExpired()
        : gitHubAuthExpired(githubOAuth);
    case 'auth-required':
      return forge === 'gitlab'
        ? gitLabAuthRequired()
        : gitHubAuthRequired(githubOAuth);
    case 'permission-denied':
      // The forge refused the credential's permission, and its own sentence
      // says what was refused — the panel has nothing to add.
      return couldNotLoadDiff(input.message);
    case 'not-found':
      return forge === 'gitlab'
        ? gitLabNotFound(input.gitlabConnected === true)
        : gitHubNotFound(input.signedIn, githubOAuth);
    case 'rate-limited':
      return forge === 'gitlab'
        ? gitLabRateLimited(input.gitlabConnected === true)
        : gitHubRateLimited(input.signedIn, githubOAuth);
    case 'bad-request':
      return couldNotLoadDiff(input.message);
  }
}

/** The GitHub reading of the failures, for an answer that carries no reason. */
function gitHubByStatus(
  input: { signedIn: boolean; message?: string; githubOAuth?: boolean },
  status: number | undefined
): ReviewFailure {
  const githubOAuth = input.githubOAuth ?? true;
  if (isRateLimited(status)) {
    return gitHubRateLimited(input.signedIn, githubOAuth);
  }
  if (status === UNAUTHORIZED) {
    return gitHubAuthExpired(githubOAuth);
  }
  if (status === NOT_FOUND) {
    return gitHubNotFound(input.signedIn, githubOAuth);
  }
  return couldNotLoadDiff(input.message);
}

function gitHubRateLimited(
  signedIn: boolean,
  githubOAuth: boolean
): ReviewFailure {
  // GitHub's own body names an address and recommends authentication, which
  // is the right advice in the wrong voice: this panel can offer the button
  // instead of describing it. So the copy here replaces it.
  if (signedIn) {
    return {
      action: 'retry',
      get message() {
        return m.review_failure_you_used_all_5_000_github_requests_for();
      },
      get title() {
        return m.review_failure_hourly_github_rate_limit_reached();
      },
    };
  }
  return githubOAuth
    ? {
        action: 'setup',
        get message() {
          return m.review_failure_github_limits_unauthenticated_requests_to_60_per_hour();
        },
        get title() {
          return m.review_failure_github_rate_limit_reached();
        },
      }
    : {
        action: 'retry',
        get message() {
          return m.review_failure_github_limits_unauthenticated_requests_to_60_per_hour_wait();
        },
        get title() {
          return m.review_failure_github_rate_limit_reached();
        },
      };
}

function gitHubAuthExpired(githubOAuth: boolean): ReviewFailure {
  // The Worker answers 401 for a cookie whose token is spent, and the browser
  // refreshes it and asks again before this panel sees the status. So a 401
  // that reaches here is a refresh that failed, and the session behind it is
  // gone — whatever `signedIn` still says, since that was read before it went.
  // The next step is the sign-in, and `/setup` is where that happens — when
  // this deployment has one to offer.
  return githubOAuth
    ? {
        action: 'setup',
        get message() {
          return m.review_failure_your_github_sign_in_is_no_longer_valid();
        },
        get title() {
          return m.review_failure_github_sign_in_expired();
        },
      }
    : {
        action: 'retry',
        get message() {
          return m.review_failure_your_github_sign_in_is_no_longer_valid_and();
        },
        get title() {
          return m.review_failure_github_sign_in_expired();
        },
      };
}

function gitHubAuthRequired(githubOAuth: boolean): ReviewFailure {
  // GitHub asked for an account nobody offered it: the caller is anonymous
  // and the target is not publicly readable. The fix is the sign-in.
  return githubOAuth
    ? {
        action: 'setup',
        get message() {
          return m.review_failure_github_asks_for_a_sign_in_to_view_this();
        },
        get title() {
          return m.review_failure_github_requires_a_sign_in();
        },
      }
    : {
        action: 'retry',
        get message() {
          return m.review_failure_github_asks_for_a_sign_in_to_view_this_2();
        },
        get title() {
          return m.review_failure_github_requires_a_sign_in();
        },
      };
}

function gitHubNotFound(
  signedIn: boolean,
  githubOAuth: boolean
): ReviewFailure {
  // GitHub's own body is the single word "Not Found", which is true and
  // useless. What the reviewer needs is the reason it is the same word for
  // both cases, and the one thing they can do about it — when there is one.
  if (signedIn) {
    return githubOAuth
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
          action: 'retry',
          get message() {
            return m.review_failure_github_returned_not_found_because_ghdiff_is_not_installed();
          },
          get title() {
            return m.review_failure_ghdiff_needs_access_to_this_repository();
          },
        };
  }
  return githubOAuth
    ? {
        action: 'setup',
        get message() {
          return m.review_failure_github_returns_not_found_for_private_repositories_when();
        },
        get title() {
          return m.review_failure_repository_not_found_or_private();
        },
      }
    : {
        action: 'retry',
        get message() {
          return m.review_failure_github_returns_not_found_for_private_repositories_when_you();
        },
        get title() {
          return m.review_failure_repository_not_found_or_private();
        },
      };
}

/**
 * The GitLab reading of the same failures, for an answer that carries no
 * reason. The fix is `connect` where a credential would help — a rate limit an
 * account raises, a 401 that is the instance asking for one, and a 404 that
 * says private-or-missing with GitHub's own deliberate ambiguity. `connected`
 * is whether this browser holds a grant for the target's own host: past that
 * point a 404 is just missing, and a 401 is a grant that died rather than the
 * instance asking for one.
 */
function gitLabByStatus(
  input: { message?: string; gitlabConnected?: boolean },
  status: number | undefined
): ReviewFailure {
  const connected = input.gitlabConnected === true;
  if (isRateLimited(status)) {
    return gitLabRateLimited(connected);
  }
  if (status === UNAUTHORIZED) {
    return connected ? gitLabAuthExpired() : gitLabAuthRequired();
  }
  if (status === NOT_FOUND) {
    return gitLabNotFound(connected);
  }
  return couldNotLoadDiff(input.message);
}

function gitLabRateLimited(connected: boolean): ReviewFailure {
  return connected
    ? {
        action: 'retry',
        get message() {
          return m.review_failure_this_gitlab_instance_is_limiting_requests_wait_a_few();
        },
        get title() {
          return m.review_failure_gitlab_rate_limit_reached();
        },
      }
    : {
        action: 'connect',
        get message() {
          return m.review_failure_this_gitlab_instance_is_limiting_anonymous_requests_connect_an();
        },
        get title() {
          return m.review_failure_gitlab_rate_limit_reached();
        },
      };
}

function gitLabAuthRequired(): ReviewFailure {
  // The genuinely anonymous case: the instance asks for an account the caller
  // does not hold. Connected-but-refused is `gitLabAuthExpired` instead.
  return {
    action: 'connect',
    get message() {
      return m.review_failure_this_gitlab_instance_does_not_allow_anonymous_reads_connect();
    },
    get title() {
      return m.review_failure_gitlab_requires_a_sign_in();
    },
  };
}

function gitLabAuthExpired(): ReviewFailure {
  // A grant this browser holds is spent or revoked: reconnecting is the fix,
  // and the wording must not read as "you are anonymous" — the reviewer
  // connected already.
  return {
    action: 'connect',
    get message() {
      return m.review_failure_your_connection_to_this_gitlab_instance_is_no_longer();
    },
    get title() {
      return m.review_failure_gitlab_connection_expired();
    },
  };
}

function gitLabNotFound(connected: boolean): ReviewFailure {
  return connected
    ? {
        action: 'retry',
        get message() {
          return m.review_failure_gitlab_returned_not_found_the_project_does_not_exist();
        },
        get title() {
          return m.review_failure_project_not_found();
        },
      }
    : {
        action: 'connect',
        get message() {
          return m.review_failure_gitlab_returns_not_found_for_private_projects_when_you();
        },
        get title() {
          return m.review_failure_project_not_found_or_private();
        },
      };
}
