// Minimal GitHub REST client.
//
// The token never reaches the server's environment by default: the browser
// holds the user's personal access token and forwards it on each request, the
// same way diffs-hub does. GITHUB_TOKEN is honoured as a fallback so a
// single-user deployment can skip the browser step.

import { rateLimitedStatus } from '../rateLimit.ts';

const GITHUB_API_ROOT = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
// GitHub answers 403 "Request forbidden by administrative rules" to a request
// that carries no User-Agent. Node's fetch sends one of its own; workerd sends
// none, so every request from this client names itself.
const USER_AGENT = 'ghdiff';
const JSON_MEDIA_TYPE = 'application/vnd.github+json';
const DIFF_MEDIA_TYPE = 'application/vnd.github.diff';
const RAW_MEDIA_TYPE = 'application/vnd.github.raw';

export class GitHubError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

/** Reads the caller's token from the request, then from the environment. */
export function readGitHubToken(request: Request): string | undefined {
  const header = request.headers.get('authorization');
  const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer != null && bearer.length > 0) {
    return bearer;
  }
  const fromEnv = process.env.GITHUB_TOKEN?.trim();
  return fromEnv != null && fromEnv.length > 0 ? fromEnv : undefined;
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
  const body = await response.text();
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === 'object' &&
      parsed != null &&
      'message' in parsed &&
      typeof parsed.message === 'string'
    ) {
      return parsed.message;
    }
  } catch {
    // Fall through to the raw body.
  }
  return body.trim().length > 0 ? body.trim() : response.statusText;
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

// --- Where a whole worktree's archive comes from ------------------------------

const GITHUB_CODELOAD_HOST = 'https://codeload.github.com';

/**
 * Fetches the tar.gz of one ref's whole worktree — the transport behind the
 * expand controls, which carries the new side of every changed file in one
 * request instead of one request each.
 *
 * The source turns on the token, the same split as a single file. A caller
 * with none is served by codeload, the host behind github.com's own archive
 * links: it answers for a public repository, resolves `refs/pull/{n}/head`,
 * and spends none of the sixty REST requests an anonymous hour holds. A caller
 * with a token goes through the API's tarball endpoint, which is the one of
 * the two that answers for a private repository; it redirects to a signed
 * codeload URL, and fetch drops the Authorization header on the cross-origin
 * hop, which the signed target does not want anyway.
 */
export async function githubArchive(
  owner: string,
  repo: string,
  ref: string,
  token: string | undefined
): Promise<Response> {
  const encodedRef = encodeRefForPath(ref);
  const url =
    token == null
      ? `${GITHUB_CODELOAD_HOST}/${owner}/${repo}/tar.gz/${encodedRef}`
      : `${GITHUB_API_ROOT}/repos/${owner}/${repo}/tarball/${encodedRef}`;
  const response = await fetch(url, {
    cache: 'no-store',
    headers:
      token == null
        ? { accept: 'application/x-gzip', 'user-agent': USER_AGENT }
        : headers(token, JSON_MEDIA_TYPE),
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new GitHubError(
      rateLimitedStatus(response.status, response.headers),
      // codeload answers a missing ref and an invisible repository alike with
      // a bare 404 and no sentence of its own, so the caller writes one.
      response.status === 404
        ? 'GitHub has no archive for that commit. A private repository needs a token.'
        : await readErrorMessage(response)
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
