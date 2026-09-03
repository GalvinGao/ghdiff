// Every address the ghdiff GitHub App has on github.com, built in one place.
//
// This is the same rule `githubUrls.ts` holds for the addresses of a repository:
// a query string assembled at one call site cannot then differ from the next.
// It replaces `githubToken.ts`, which built a pre-filled form asking for four
// permissions on a personal access token. Nothing here asks for a permission:
// GitHub is told the App's permissions once, when it is registered, and its own
// consent screen is what names them to a reviewer. Which permissions those are
// is written in CLAUDE.md, beside the rest of the registration.

const GITHUB_WEB = 'https://github.com';

/** Where GitHub asks the reviewer to authorize the App. */
const AUTHORIZE_PATH = '/login/oauth/authorize';

/** Where a code, and later a refresh token, is exchanged for an access token. */
export const TOKEN_URL = `${GITHUB_WEB}/login/oauth/access_token`;

/** The path this app answers GitHub's redirect on, under any origin. */
export const CALLBACK_PATH = '/api/auth/callback';

/**
 * Where this app answers GitHub's redirect, for the origin the request arrived
 * on. Derived rather than configured, so one App registered with both callback
 * URLs serves ghdiff.com and a laptop alike and neither can be sent to the
 * other's. GitHub compares this against its own list, so an origin that is not
 * registered fails at GitHub with a sentence about the redirect URI rather than
 * landing somewhere unexpected.
 */
export function callbackUrl(requestUrl: string): string {
  return new URL(CALLBACK_PATH, requestUrl).toString();
}

/**
 * Where the reviewer goes to authorize the App.
 *
 * PKCE is here even though the exchange also carries the client secret. The code
 * travels back through the reviewer's own browser and through whatever sits in
 * front of it, and `code_verifier` is the half of the pair that never leaves
 * this Worker — so a code lifted out of a redirect, a log, or a referrer cannot
 * be spent by whoever lifted it.
 */
export function authorizeUrl(input: {
  challenge: string;
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(AUTHORIZE_PATH, GITHUB_WEB);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

// --- What a sign-in that did not work says -----------------------------------
//
// The callback has nowhere to draw a panel: it is a redirect, and the page that
// draws things is the one it redirects to. So the reason travels as a query
// parameter and the screen reads it, says its line, and takes it back out of the
// address. Four reasons, because there are four ways this ends badly and they
// are not the same advice: three of them are "start again" and one of them is
// the reviewer having decided not to.

/** The query parameter a failed sign-in leaves on the page it returns to. */
export const AUTH_ERROR_PARAM = 'ghdiff_auth';

export type AuthFailure = 'denied' | 'expired' | 'mismatch' | 'github';

const AUTH_FAILURE_MESSAGE: Record<AuthFailure, string> = {
  denied: 'Sign-in was not completed on GitHub. Try again when you are ready.',
  expired:
    'The sign-in session timed out on GitHub. Start the sign-in process again.',
  mismatch:
    'Security verification failed during GitHub sign-in. Start the process again from ghdiff.',
  github: 'GitHub could not complete the sign-in. Try again in a moment.',
};

/**
 * What to say about a reason in the address, if it is a reason this app wrote.
 * The value arrives in the address bar, where anybody can type one, so this is
 * `Object.hasOwn` and not `in`: `in` walks the prototype chain, and `?ghdiff_auth=toString`
 * would otherwise put a function's source on screen as a sentence.
 */
export function authFailureMessage(raw: string | null): string | undefined {
  return raw != null && Object.hasOwn(AUTH_FAILURE_MESSAGE, raw)
    ? AUTH_FAILURE_MESSAGE[raw as AuthFailure]
    : undefined;
}

/**
 * Where the callback sends a reviewer whose sign-in failed: back where they
 * were, with the reason on the address. `returnTo` has already been through
 * `safeReturnTo`, and this rebuilds it rather than concatenating, so a path that
 * already carries a query or a fragment keeps both.
 */
export function authFailureUrl(returnTo: string, reason: AuthFailure): string {
  const base = 'https://ghdiff.invalid';
  const url = new URL(returnTo, base);
  url.searchParams.set(AUTH_ERROR_PARAM, reason);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Where a reviewer installs the App. This is the step a personal access token
 * did not have and an App cannot do without: a user-to-server token reaches only
 * the repositories the App is installed on, so a signed-in reviewer looking at a
 * 404 usually needs this page rather than a different credential.
 */
export function installUrl(slug: string): string {
  return `${GITHUB_WEB}/apps/${slug}/installations/new`;
}
