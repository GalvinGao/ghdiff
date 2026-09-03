// Minimal GitHub REST client.
//
// The token never reaches the server's disk. A reviewer who signed in through
// the GitHub App has it in a sealed cookie the browser holds and no script can
// read; a caller that names its own on the `Authorization` header is honoured
// ahead of that, which is what keeps curl and a script working; and
// GITHUB_TOKEN is the last fallback, so a single-user deployment can skip the
// browser step. `resolveGitHubToken` is where those three meet.

import { gitHubErrorMessage } from '../githubError.ts';
import { rateLimitedStatus } from '../rateLimit.ts';
import { accessTokenUsable, withinMaxAge } from '../session.ts';
import { readKeyring, readSession } from './session.ts';

const GITHUB_API_ROOT = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
// GitHub answers 403 "Request forbidden by administrative rules" to a request
// that carries no User-Agent. Node's fetch sends one of its own; workerd sends
// none, so every request from this client names itself. Exported because the
// App's own three calls in `./githubApp.ts` go to two hosts this module does
// not, and the rule is about every request to GitHub rather than about this
// client.
export const USER_AGENT = 'ghdiff';
const JSON_MEDIA_TYPE = 'application/vnd.github+json';
const DIFF_MEDIA_TYPE = 'application/vnd.github.diff';
const RAW_MEDIA_TYPE = 'application/vnd.github.raw';

/** A token, and whether the sealed session cookie is where it came from. */
export interface ResolvedToken {
  token?: string;
  fromSession: boolean;
}

export class GitHubError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
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
 * `fromSession` travels with it because the account menu needs it: a viewer
 * resolved from `GITHUB_TOKEN` has no sign-out to offer, and one resolved from
 * the cookie does. Nothing else in the app reads it.
 */
export async function resolveGitHubToken(
  request: Request
): Promise<ResolvedToken> {
  const header = request.headers.get('authorization');
  const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer != null && bearer.length > 0) {
    return { token: bearer, fromSession: false };
  }

  const keyring = readKeyring();
  if (keyring != null) {
    const session = await readSession(request, keyring);
    const now = Date.now();
    if (
      session != null &&
      withinMaxAge(session, now) &&
      accessTokenUsable(session, now)
    ) {
      return { token: session.accessToken, fromSession: true };
    }
  }

  const fromEnv = process.env.GITHUB_TOKEN?.trim();
  return {
    token: fromEnv != null && fromEnv.length > 0 ? fromEnv : undefined,
    fromSession: false,
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

export async function githubWrite<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  token: string | undefined,
  body?: unknown
): Promise<T | undefined> {
  const response = await fetch(`${GITHUB_API_ROOT}${path}`, {
    method,
    cache: 'no-store',
    headers: {
      ...headers(token, JSON_MEDIA_TYPE),
      ...(body == null ? {} : { 'content-type': 'application/json' }),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new GitHubError(
      rateLimitedStatus(response.status, response.headers),
      await readErrorMessage(response)
    );
  }
  if (response.status === 204) {
    return undefined;
  }
  return (await response.json()) as T;
}

/**
 * POST a GraphQL query. Throws GitHubError on a transport failure, on a
 * response that carries `errors`, and on a null `data`.
 *
 * REST has no field for a review decision and no field for a check rollup, so
 * the open pull request list asks GraphQL for both in one request per
 * repository. GraphQL refuses an anonymous caller outright, which is why the
 * REST path stays as the fallback for a reviewer with no token.
 */
export async function githubGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  token: string
): Promise<T> {
  const response = await fetch(`${GITHUB_API_ROOT}/graphql`, {
    method: 'POST',
    cache: 'no-store',
    // Through `headers()`, so the GraphQL endpoint gets the same User-Agent as
    // every other call. workerd sends none of its own, and GitHub answers a
    // header-less request with 403.
    headers: {
      ...headers(token, JSON_MEDIA_TYPE),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new GitHubError(
      rateLimitedStatus(response.status, response.headers),
      await readErrorMessage(response)
    );
  }
  const body = (await response.json()) as {
    data?: T | null;
    errors?: { message?: string }[];
  };
  // GraphQL answers 200 with an `errors` array for a repository the token
  // cannot read, so the status alone does not say whether this worked.
  if (body.errors != null && body.errors.length > 0) {
    throw new GitHubError(
      200,
      body.errors[0]?.message ?? 'GitHub rejected that query.'
    );
  }
  if (body.data == null) {
    throw new GitHubError(200, 'GitHub returned no data for that query.');
  }
  return body.data;
}

/**
 * GET a resource GitHub answers with plain bytes. Returns the response itself
 * rather than its text, so the body can stream: a patch runs to tens of
 * megabytes and a source file is not much smaller.
 */
async function githubStream(
  path: string,
  token: string | undefined,
  accept: string
): Promise<Response> {
  const response = await fetch(`${GITHUB_API_ROOT}${path}`, {
    cache: 'no-store',
    headers: headers(token, accept),
  });
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
  token: string | undefined
): Promise<Response> {
  return githubStream(path, token, DIFF_MEDIA_TYPE);
}

/**
 * GET one file's contents. The raw media type is what takes this past the 1 MB
 * ceiling on the base64 form of the same endpoint.
 */
export function githubRaw(
  path: string,
  token: string | undefined
): Promise<Response> {
  return githubStream(path, token, RAW_MEDIA_TYPE);
}

export interface GitHubUser {
  login: string;
  avatar_url?: string;
  name?: string | null;
  /** 'User', 'Organization', or 'Bot' for a GitHub App. */
  type?: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  draft?: boolean;
  state?: string;
  merged_at?: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  /** Only the single-pull endpoint returns this; a list omits it. */
  body?: string | null;
  user: GitHubUser | null;
  head: { sha: string; ref: string };
  base: { ref: string };
  additions?: number;
  deletions?: number;
  changed_files?: number;
  commits?: number;
}

/** What `POST /pulls/{n}/reviews` answers with. */
export interface GitHubReview {
  id: number;
  state: string;
  submitted_at?: string | null;
  html_url?: string;
}

export interface GitHubReviewComment {
  commit_id: string;
  original_commit_id: string;
  diff_hunk: string;
  id: number;
  path: string;
  body: string;
  line: number | null;
  start_line: number | null;
  original_line: number | null;
  original_start_line: number | null;
  side: string | null;
  start_side: string | null;
  created_at: string;
  html_url: string;
  user: GitHubUser | null;
  in_reply_to_id?: number;
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

export interface GitHubDiffTargetPath {
  /** Path on github.com, without the .diff suffix. */
  webPath: string;
  /** Path on api.github.com for the diff media type. */
  apiPath: string;
}

/** Fetches the web `.diff` URL. Throws GitHubError on a non-2xx response. */
export async function githubWebDiff(
  webPath: string,
  token: string | undefined
): Promise<Response> {
  const webHeaders: Record<string, string> = {
    accept: 'text/plain',
    'user-agent': USER_AGENT,
  };
  if (token != null) {
    webHeaders.authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${GITHUB_WEB_HOST}${webPath}.diff`, {
    cache: 'no-store',
    headers: webHeaders,
    redirect: 'follow',
  });
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
  path: string
): Promise<Response> {
  const url = `${GITHUB_RAW_HOST}/${owner}/${repo}/${encodeRefForPath(
    ref
  )}/${encodeRefForPath(path)}`;
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { accept: 'text/plain', 'user-agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new GitHubError(
      rateLimitedStatus(response.status, response.headers),
      // This host answers a missing file and an invisible repository alike with
      // a bare 404 and no sentence of its own, so the caller writes one.
      response.status === 404
        ? 'GitHub has no such file on that commit. A private repository needs a token.'
        : await readErrorMessage(response)
    );
  }
  return response;
}
