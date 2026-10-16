// Minimal GitHub REST client.
//
// The token never reaches the server's disk. A reviewer who signed in through
// the GitHub App has it in a sealed cookie the browser holds and no script can
// read; a caller that names its own on the `Authorization` header is honoured
// ahead of that, which is what keeps curl and a script working; and
// GITHUB_TOKEN is the last fallback, so a single-user deployment can skip the
// browser step. `resolveGitHubToken` is where those three meet.

import type { FailureMeta } from '@/lib/failure';
import { gitHubErrorMessage } from '@/lib/github/error';
import { rateLimitedStatus } from '@/lib/rateLimit';
import type { DeploymentConfig } from '@/lib/server/config';
import {
  accessTokenUsable,
  refreshDue,
  type SessionPayload,
  withinMaxAge,
} from '@/lib/session';
import { m } from '@/paraglide/messages.js';

const GITHUB_API_ROOT = 'https://api.github.com';
export const GITHUB_API_VERSION = '2022-11-28';
// GitHub answers 403 "Request forbidden by administrative rules" to a request
// that carries no User-Agent. Node's fetch sends one of its own; workerd sends
// none, so every request from this client names itself. Exported because the
// App's own three calls in `./app.ts` go to two hosts this module does
// not, and the rule is about every request to GitHub rather than about this
// client.
export const USER_AGENT = 'ghdiff';
const JSON_MEDIA_TYPE = 'application/vnd.github+json';
/**
 * JSON, with every markdown field also rendered as `*_html`. That HTML is the
 * one place GitHub hands out signed addresses for a private body's pictures.
 */
export const FULL_JSON_MEDIA_TYPE = 'application/vnd.github.full+json';
const DIFF_MEDIA_TYPE = 'application/vnd.github.diff';
const RAW_MEDIA_TYPE = 'application/vnd.github.raw';

/** A token, and whether the sealed session cookie is where it came from. */
export interface ResolvedToken {
  token?: string;
  fromSession: boolean;
  /**
   * True when the cookie holds a session whose access token is spent and whose
   * refresh token is live. There is no token to speak with, and the route must
   * answer 401 rather than go on without one: that answer is what sends the
   * browser to `/api/auth/refresh`, and the same request comes back a moment
   * later with a token in its cookie. See `refreshDue` in `@/lib/session`.
   */
  refreshDue: boolean;
}

/**
 * The error every forge's failure travels as — GitHub's, GitLab's, the media
 * proxy's — so no caller asks which SDK threw. `failure` is the typed reason
 * the client acts on, attached where the throw site knows it (the forge gate's
 * `not-served`); a bare status is mapped to one downstream by
 * `failureForStatus` where only the status is known.
 */
export class GitHubError extends Error {
  readonly status: number;
  readonly failure?: FailureMeta;

  constructor(status: number, message: string, failure?: FailureMeta) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.failure = failure;
  }
}

/**
 * The token this request speaks with, from the three places one can come from,
 * most specific first.
 *
 * The header wins because a caller that named a credential meant that one. The
 * sealed session cookie is next, and it is the ordinary case for a reviewer in a
 * browser. `GITHUB_TOKEN` is last, and it is a single-user deployment's way to
 * skip the browser step entirely.
 *
 * `accessTokenUsable` is asked without the refresh skew, deliberately: a token
 * five minutes from its expiry still works, and answering with nothing here
 * would drop a signed-in reviewer to anonymous for those five minutes rather
 * than let `/api/auth/refresh` mend it behind them.
 *
 * A cookie whose token has died is not the same as no cookie, and it is not
 * answered the same way. `refreshDue` names the one reading — inside the
 * ceiling, access token spent, refresh token live — and the route that asked
 * answers it with 401 before anything is asked of GitHub. The client refreshes
 * on a 401 and on nothing else, so a route that went on anonymously would leave
 * the cookie unmended for the rest of its 180 days: no viewer, Not Found for
 * every private diff, and a reviewer told to sign in eight hours after they did.
 * It outranks `GITHUB_TOKEN`, or that reviewer's ninth hour would be spent as
 * the deployment's own account. A session past the ceiling or with no refresh
 * token is nobody signed in, and falls through as it always did.
 *
 * `fromSession` travels with it because the account menu needs it: a viewer
 * resolved from `GITHUB_TOKEN` has no sign-out to offer, and one resolved from
 * the cookie does. Nothing else in the app reads it.
 */
export async function resolveGitHubToken(
  config: DeploymentConfig,
  session: SessionPayload | undefined,
  request: Request
): Promise<ResolvedToken> {
  const header = request.headers.get('authorization');
  const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer != null && bearer.length > 0) {
    return { token: bearer, fromSession: false, refreshDue: false };
  }

  const now = Date.now();
  if (session != null) {
    const github = session.github;
    // A GitLab-only session has no GitHub grant: for GitHub it is nobody.
    if (
      github != null &&
      withinMaxAge(session, now) &&
      accessTokenUsable(github, now)
    ) {
      return {
        token: github.accessToken,
        fromSession: true,
        refreshDue: false,
      };
    }
    if (refreshDue(session, now)) {
      return { token: undefined, fromSession: false, refreshDue: true };
    }
  }

  return {
    token: config.github.token,
    fromSession: false,
    refreshDue: false,
  };
}

function headers(token: string | undefined, accept: string): HeadersInit {
  const result: Record<string, string> = {
    accept,
    'user-agent': USER_AGENT,
    'x-github-api-version': GITHUB_API_VERSION,
  };
  if (token != null) {
    result.authorization = `Bearer ${token}`;
  }
  return result;
}

async function readErrorMessage(response: Response): Promise<string> {
  return gitHubErrorMessage(await response.text(), response.statusText);
}

/** GET a JSON resource. Throws GitHubError on a non-2xx response. */
export async function githubJson<T>(
  path: string,
  token: string | undefined,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${GITHUB_API_ROOT}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { ...headers(token, JSON_MEDIA_TYPE), ...init?.headers },
  });
  if (!response.ok) {
    throw new GitHubError(
      rateLimitedStatus(response.status, response.headers),
      await readErrorMessage(response)
    );
  }
  return (await response.json()) as T;
}

/**
 * The header that asks GitHub to answer 304 and no body when the caller's copy
 * is still current. Every host that serves a patch or a file honours it — the
 * API, the web diff host and the raw host — and a 304 from the API spends none
 * of the rate limit.
 */
function conditional(ifNoneMatch: string | undefined): Record<string, string> {
  return ifNoneMatch == null ? {} : { 'if-none-match': ifNoneMatch };
}

/**
 * GET a resource GitHub answers with plain bytes. Returns the response itself
 * rather than its text, so the body can stream: a patch runs to tens of
 * megabytes and a source file is not much smaller. A 304 is returned as it is,
 * for the caller that sent `ifNoneMatch`.
 */
async function githubStream(
  path: string,
  token: string | undefined,
  accept: string,
  ifNoneMatch?: string
): Promise<Response> {
  const response = await fetch(`${GITHUB_API_ROOT}${path}`, {
    cache: 'no-store',
    headers: { ...headers(token, accept), ...conditional(ifNoneMatch) },
  });
  if (response.status === 304) return response;
  if (!response.ok) {
    throw new GitHubError(
      rateLimitedStatus(response.status, response.headers),
      await readErrorMessage(response)
    );
  }
  return response;
}

/** GET a unified diff. */
export function githubDiff(
  path: string,
  token: string | undefined,
  ifNoneMatch?: string
): Promise<Response> {
  return githubStream(path, token, DIFF_MEDIA_TYPE, ifNoneMatch);
}

/**
 * GET one file's contents. The raw media type is what takes this past the 1 MB
 * ceiling on the base64 form of the same endpoint.
 */
export function githubRaw(
  path: string,
  token: string | undefined,
  ifNoneMatch?: string
): Promise<Response> {
  return githubStream(path, token, RAW_MEDIA_TYPE, ifNoneMatch);
}

export function encodeRefForPath(ref: string): string {
  // Branch names can hold a slash, which must survive as a path segment.
  return ref.split('/').map(encodeURIComponent).join('/');
}

// --- Where a diff actually comes from ---------------------------------------
//
// The API's unified-diff media type caps a pull request at 300 files and
// 20000 lines, then answers 406. The web host that serves github.com's own
// `.diff` links has no such cap: it returned 43 MB and 2188 files for
// oven-sh/bun#30412, which the API refuses outright. So the web URL is the
// primary source and the API is the fallback, which is what diffs-hub does.
//
// github.com redirects a `.diff` request to patch-diff.githubusercontent.com
// with a signed URL. Only the first hop needs the token: fetch drops the
// Authorization header on a cross-origin redirect, and the signed target does
// not want it.
//
// **That host does not authenticate a GitHub App user-to-server token.** It was
// measured, not assumed. A public pull request with no credential answers from
// `web-diff`; the same route with a live `ghu_` token on a private pull request
// answers from `api-diff`, which means the web attempt failed even though the
// token was sent and was good enough for `/user`. github.com's `.diff` endpoint
// takes a personal access token and refuses a `ghu_` one.
//
// So a private diff is capped after all: 300 files and 20000 lines from the API,
// then `synthesizePatch` from the file list, which is where GitHub starts leaving
// out the `patch` field on large files. A 162-file private pull request came back
// with 96 of its files carrying no lines. `describeSynthesisGaps` is what says so
// on screen, and there is no dishonesty in the chain — but a reviewer on a large
// private diff loses content they used to get.
//
// A `Bearer` header still reaches this host, because a personal access token
// still works here. `resolveGitHubToken` honours that header ahead of the cookie,
// which is the seam a future fallback can use without putting a token form back
// in front of everybody.

const GITHUB_WEB_HOST = 'https://github.com';

/** Fetches the web `.diff` URL. Throws GitHubError on a non-2xx response. */
export async function githubWebDiff(
  webPath: string,
  token: string | undefined,
  ifNoneMatch?: string
): Promise<Response> {
  // The header survives the redirect to the signed host, which is the one that
  // compares it: fetch drops only the authorization across origins.
  const webHeaders: Record<string, string> = {
    accept: 'text/plain',
    'user-agent': USER_AGENT,
    ...conditional(ifNoneMatch),
  };
  if (token != null) {
    webHeaders.authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${GITHUB_WEB_HOST}${webPath}.diff`, {
    cache: 'no-store',
    headers: webHeaders,
    redirect: 'follow',
  });
  if (response.status === 304) return response;
  if (!response.ok) {
    throw new GitHubError(
      rateLimitedStatus(response.status, response.headers),
      await readErrorMessage(response)
    );
  }
  return response;
}

// --- Where one file's contents comes from ------------------------------------

const GITHUB_RAW_HOST = 'https://raw.githubusercontent.com';

/**
 * Fetches one file from the host that serves github.com's own **Raw** links.
 * It answers for a public repository without a token and without spending any
 * of the REST quota, which is what an anonymous reviewer's comments and pull
 * request list need the whole of. It resolves every ref shape a review target
 * has, `refs/pull/{n}/head` included.
 *
 * A private repository is not this host's job. `githubRaw` is, and the caller
 * picks between them on whether it holds a token.
 */
export async function githubWebRaw(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  ifNoneMatch?: string
): Promise<Response> {
  const url = `${GITHUB_RAW_HOST}/${owner}/${repo}/${encodeRefForPath(
    ref
  )}/${encodeRefForPath(path)}`;
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      accept: 'text/plain',
      'user-agent': USER_AGENT,
      ...conditional(ifNoneMatch),
    },
    redirect: 'follow',
  });
  if (response.status === 304) return response;
  if (!response.ok) {
    throw new GitHubError(
      rateLimitedStatus(response.status, response.headers),
      // This host answers a missing file and an invisible repository alike with
      // a bare 404 and no sentence of its own, so the caller writes one.
      response.status === 404
        ? m.github_github_has_no_such_file_on_that_commit()
        : await readErrorMessage(response)
    );
  }
  return response;
}
