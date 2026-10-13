import {
  ORIGIN,
  rpc as clientRpc,
  raw as clientRaw,
  type RawAnswer,
  type RawOptions,
  type RpcAnswer,
} from '@test/e2e/lib/client';
import { isIsoDate, MARKED, requireEnv } from '@test/e2e/lib/util';

// Shared machinery for the ghdiff e2e suite, GitHub flavor: the suite's ref,
// a client for the GitHub API the assertions cross-check against, and the
// fixture reset. The wire client lives in ../lib/client.ts, the small
// helpers in ../lib/util.ts — both re-exported here so a test file imports
// this module alone.
//
// Every artifact the suite creates carries a body starting with MARK, and the
// reset deletes by that prefix — the seeded fixture content and anything a
// human wrote are never matched.
import type { PullRef } from '@/lib/forges';

export { ORIGIN, isIsoDate };
export type {
  RpcAnswer,
  RawAnswer,
  ViewerGetAnswer,
} from '@test/e2e/lib/client';

// The fixture repository, `owner/repo`; the runner names its own copy.
const FIXTURE = requireEnv('E2E_GITHUB_REPO').split('/');
export const OWNER = FIXTURE[0] ?? '';
export const REPO = FIXTURE[1] ?? '';
export const GH = `https://api.github.com/repos/${OWNER}/${REPO}`;
export const TOKEN = requireEnv('GITHUB_TOKEN');
export const MARK = `[e2e ${Date.now()}]`;
export const PRS = [1, 2, 3];

export const ref = (number: number): PullRef => ({
  forge: 'github',
  owner: OWNER,
  repo: REPO,
  number,
});

export interface GitHubViewer {
  login: string;
  [key: string]: unknown;
}

// Who the token belongs to, read once at import.
export const VIEWER: GitHubViewer = await fetch('https://api.github.com/user', {
  headers: { authorization: `Bearer ${TOKEN}` },
}).then((r) => r.json() as Promise<GitHubViewer>);

// --- ghdiff RPC and raw routes, pre-bound to the fixture token ---------------

export interface RpcOptions {
  /** 'none' sends no credential — the anonymous path. */
  auth?: 'bearer' | 'none';
  cookie?: string;
}

export const rpc = <T = unknown>(
  path: string,
  input: unknown,
  { auth = 'bearer', cookie }: RpcOptions = {}
): Promise<RpcAnswer<T>> =>
  clientRpc<T>(path, input, {
    token: auth === 'bearer' ? TOKEN : undefined,
    cookie,
  });

export const raw = (
  path: string,
  {
    bearer = true,
    ...rest
  }: Omit<RawOptions, 'token'> & {
    bearer?: boolean;
  } = {}
): Promise<RawAnswer> =>
  clientRaw(path, { token: bearer ? TOKEN : undefined, ...rest });

// --- GitHub direct (assertion side) ------------------------------------------

export interface GhReviewComment {
  id: number;
  body?: string;
  in_reply_to_id?: number;
  path?: string;
  line?: number;
}

export interface GhIssueComment {
  id: number;
  body?: string;
}

export interface GhReview {
  id: number;
  state: string;
  body?: string;
}

export async function gh<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${GH}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null as T;
  const text = await res.text();
  if (!res.ok)
    throw new Error(`GitHub ${method} ${path}: ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

export async function gql<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (!res.ok || json.errors != null) {
    throw new Error(`GraphQL: ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.data as T;
}

/** Every page of a list endpoint, 100 entries at a time. */
export async function paginate<T>(path: string): Promise<T[]> {
  const all: T[] = [];
  const glue = path.includes('?') ? '&' : '?';
  for (let page = 1; ; page++) {
    const batch = await gh<T[]>(
      'GET',
      `${path}${glue}per_page=100&page=${page}`
    );
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

export const reviewComments = (pr: number): Promise<GhReviewComment[]> =>
  paginate(`/pulls/${pr}/comments`);
export const issueComments = (pr: number): Promise<GhIssueComment[]> =>
  paginate(`/issues/${pr}/comments`);
export const reviews = (pr: number): Promise<GhReview[]> =>
  paginate(`/pulls/${pr}/reviews`);
/** The comments on one review, read through the review's own endpoint. */
export const reviewCommentsOf = (
  pr: number,
  review: number
): Promise<GhReviewComment[]> =>
  paginate(`/pulls/${pr}/reviews/${review}/comments`);
export const threadIsResolved = (
  nodeId: string
): Promise<boolean | undefined> =>
  gql<{ node?: { isResolved?: boolean } }>(
    'query($id:ID!){ node(id:$id){ ... on PullRequestReviewThread { isResolved } } }',
    { id: nodeId }
  ).then((data) => data.node?.isResolved);

const marked = (body?: string): boolean => MARKED.test(body ?? '');

async function cleanMarked(
  pr: number,
  matches: (body: string | undefined) => boolean
): Promise<void> {
  // Ownership is read in full before anything is deleted: a read that fails
  // aborts the cleanup here, with the fixture untouched rather than
  // half-deleted.
  const [prComments, prIssueComments, prReviews] = await Promise.all([
    reviewComments(pr),
    issueComments(pr),
    reviews(pr),
  ]);
  const pending = prReviews.filter((review) => review.state === 'PENDING');
  const commentsOf = new Map<number, GhReviewComment[]>();
  for (const review of pending) {
    commentsOf.set(review.id, await reviewCommentsOf(pr, review.id));
  }

  for (const comment of prComments) {
    if (matches(comment.body)) {
      await gh('DELETE', `/pulls/comments/${comment.id}`);
    }
  }
  for (const comment of prIssueComments) {
    if (matches(comment.body)) {
      await gh('DELETE', `/issues/comments/${comment.id}`);
    }
  }
  for (const review of pending) {
    const comments = commentsOf.get(review.id) ?? [];
    // A pending review is deleted only on positive marker evidence: the body
    // blank or marked, every comment on it marked, and a marker somewhere
    // saying so. A mixed review — and a blank one carrying no comments at
    // all — is unidentified and stays.
    const blank = review.body == null || review.body === '';
    if (
      (blank || matches(review.body)) &&
      comments.every((comment) => matches(comment.body)) &&
      (matches(review.body) || comments.length > 0)
    ) {
      await gh('DELETE', `/pulls/${pr}/reviews/${review.id}`);
    }
  }
}

// Deletes every marked review comment and issue comment on the fixture PRs,
// and every pending review the marker proves ours. Submitted reviews stay:
// the API can neither delete nor dismiss a COMMENTED one, and the marker
// regex keeps them out of the assertions' way. Seeded content and
// human-written comments carry no marker and are never touched.
export async function resetFixture(): Promise<void> {
  for (const pr of PRS) await cleanMarked(pr, marked);
}

// Deletes only artifacts carrying `mark` (this process's MARK by default) —
// a test file's afterAll hook.
export async function cleanupOwn(
  prs: number[] = PRS,
  mark: string = MARK
): Promise<void> {
  for (const pr of prs) {
    await cleanMarked(pr, (body) => (body ?? '').startsWith(mark));
  }
}
