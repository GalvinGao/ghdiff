// Minimal GitHub REST client.
//
// The token never reaches the server's environment by default: the browser
// holds the user's personal access token and forwards it on each request, the
// same way diffs-hub does. GITHUB_TOKEN is honoured as a fallback so a
// single-user deployment can skip the browser step.

const GITHUB_API_ROOT = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
// GitHub answers 403 "Request forbidden by administrative rules" to a request
// that carries no User-Agent. Node's fetch sends one of its own; workerd sends
// none, so every request from this client names itself.
const USER_AGENT = 'reviewer';
const JSON_MEDIA_TYPE = 'application/vnd.github+json';
const DIFF_MEDIA_TYPE = 'application/vnd.github.diff';

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
    throw new GitHubError(response.status, await readErrorMessage(response));
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
    throw new GitHubError(response.status, await readErrorMessage(response));
  }
  if (response.status === 204) {
    return undefined;
  }
  return (await response.json()) as T;
}

/** GET a unified diff. Returns the raw response so the body can stream. */
export async function githubDiff(
  path: string,
  token: string | undefined
): Promise<Response> {
  const response = await fetch(`${GITHUB_API_ROOT}${path}`, {
    cache: 'no-store',
    headers: headers(token, DIFF_MEDIA_TYPE),
  });
  if (!response.ok) {
    throw new GitHubError(response.status, await readErrorMessage(response));
  }
  return response;
}

export interface GitHubUser {
  login: string;
  avatar_url?: string;
  name?: string | null;
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
    throw new GitHubError(response.status, await readErrorMessage(response));
  }
  return response;
}
