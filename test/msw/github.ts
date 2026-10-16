// The msw half of the GitHub forge tests: one handler per endpoint the forge
// calls, and the header assertion every call must pass. The recorder, the
// catch-all server and the leg helpers are the shared half in `./shared.ts`.
//
// Every helper scripts one endpoint for one test through `server.use()`. A
// request nothing scripted is answered 500 by the catch-all and recorded all
// the same, so a missing mock fails with a sentence that names the request
// rather than with a bare network error.

import { http, HttpResponse, type DefaultBodyType } from 'msw';
import assert from 'node:assert/strict';

import {
  type JsonLeg,
  jsonResponse,
  type MockOptions,
  type RecordedRequest,
  recordRequest,
  requestsTo,
  server,
  type TextLeg,
  textResponse,
  unscripted,
} from './shared';
import { GITHUB_API_VERSION, USER_AGENT } from '@/lib/server/github/client';

export const GITHUB_API = 'api.github.com';
export const GITHUB_WEB = 'github.com';
export const GITHUB_RAW = 'raw.githubusercontent.com';

const API_ROOT = `https://${GITHUB_API}`;
const WEB_ROOT = `https://${GITHUB_WEB}`;
const RAW_ROOT = `https://${GITHUB_RAW}`;

export interface GraphQLCall {
  query: string;
  variables: Record<string, unknown>;
}

/** The GraphQL calls made so far, with their parsed bodies. */
export function graphQLCalls(): GraphQLCall[] {
  return requestsTo(GITHUB_API, '/graphql').map(
    (record) => record.body as GraphQLCall
  );
}

/**
 * The headers every call to GitHub must carry: the app names itself in the
 * user agent (octokit appends its own version, so this is a containment
 * check), the token travels iff one was passed (octokit speaks `token`, the
 * hand-rolled fetchers `Bearer`), and the API version header belongs to
 * api.github.com and nowhere else.
 */
export function assertGitHubHeaders(
  record: RecordedRequest,
  options: { token?: string } = {}
): void {
  const agent = record.headers['user-agent'];
  assert.ok(
    agent?.includes(USER_AGENT),
    `expected a user-agent naming ${USER_AGENT}, got ${agent}`
  );
  const authorization = record.headers['authorization'];
  if (options.token == null) {
    assert.equal(authorization, undefined, 'authorization without a token');
  } else {
    assert.ok(
      authorization === `Bearer ${options.token}` ||
        authorization === `token ${options.token}`,
      `expected authorization with the token, got ${authorization}`
    );
  }
  if (record.host === GITHUB_API) {
    assert.equal(record.headers['x-github-api-version'], GITHUB_API_VERSION);
  } else {
    assert.equal(
      record.headers['x-github-api-version'],
      undefined,
      'x-github-api-version off api.github.com'
    );
  }
}

/** `GET /user`. */
export function mockGetUser(body: unknown, options: MockOptions = {}): void {
  server.use(
    http.get(`${API_ROOT}/user`, async ({ request }) => {
      await recordRequest(request);
      return jsonResponse({ body, ...options });
    })
  );
}

/** `GET /repos/{o}/{r}/pulls`. */
export function mockListPulls(
  owner: string,
  repo: string,
  body: unknown,
  options: MockOptions = {}
): void {
  server.use(
    http.get(
      `${API_ROOT}/repos/${owner}/${repo}/pulls`,
      async ({ request }) => {
        await recordRequest(request);
        return jsonResponse({ body, ...options });
      }
    )
  );
}

/**
 * `GET /repos/{o}/{r}/pulls/{n}`, which answers two media types: the JSON
 * detail octokit asks for, and the hand-rolled diff fallback's
 * `application/vnd.github.diff`. A request for a leg no test scripted is a
 * 500 that says so.
 */
export function mockPullEndpoint(
  owner: string,
  repo: string,
  number: number,
  legs: { json?: JsonLeg; diff?: TextLeg }
): void {
  server.use(
    http.get(
      `${API_ROOT}/repos/${owner}/${repo}/pulls/${number}`,
      async ({ request }) => {
        await recordRequest(request);
        if (request.headers.get('accept')?.includes('github.diff')) {
          if (legs.diff == null) return unscripted(request, 'diff of');
          return textResponse(legs.diff);
        }
        if (legs.json == null) return unscripted(request, 'JSON of');
        return jsonResponse(legs.json);
      }
    )
  );
}

/** The JSON leg of the single-pull endpoint. */
export function mockGetPull(
  owner: string,
  repo: string,
  number: number,
  body: unknown,
  options: MockOptions = {}
): void {
  mockPullEndpoint(owner, repo, number, { json: { body, ...options } });
}

/** The diff leg of the single-pull endpoint. */
export function mockPullDiff(
  owner: string,
  repo: string,
  number: number,
  body: string,
  options: MockOptions = {}
): void {
  mockPullEndpoint(owner, repo, number, { diff: { body, ...options } });
}

/** `GET /repos/{o}/{r}/pulls/{n}/comments`, the anonymous comments read. */
export function mockListComments(
  owner: string,
  repo: string,
  number: number,
  body: unknown,
  options: MockOptions = {}
): void {
  server.use(
    http.get(
      `${API_ROOT}/repos/${owner}/${repo}/pulls/${number}/comments`,
      async ({ request }) => {
        await recordRequest(request);
        return jsonResponse({ body, ...options });
      }
    )
  );
}

/**
 * `GET /repos/{o}/{r}/pulls/{n}/comments`, one answer per page, for the
 * pager: an unscripted page is a test failure, the way it is for the
 * discussions mock.
 */
export function mockListCommentsPages(
  owner: string,
  repo: string,
  number: number,
  pages: Record<number, unknown>
): void {
  server.use(
    http.get(
      `${API_ROOT}/repos/${owner}/${repo}/pulls/${number}/comments`,
      async ({ request }) => {
        await recordRequest(request);
        const page = Number(new URL(request.url).searchParams.get('page') ?? 1);
        const body = pages[page];
        if (body == null) return unscripted(request, `page ${page} of`);
        return jsonResponse({ body });
      }
    )
  );
}

/** `POST /repos/{o}/{r}/pulls/{n}/comments`. */
export function mockCreateComment(
  owner: string,
  repo: string,
  number: number,
  body: unknown,
  options: MockOptions = {}
): void {
  server.use(
    http.post(
      `${API_ROOT}/repos/${owner}/${repo}/pulls/${number}/comments`,
      async ({ request }) => {
        await recordRequest(request);
        return jsonResponse({ body, status: 201, ...options });
      }
    )
  );
}

/** `POST /repos/{o}/{r}/pulls/{n}/comments/{id}/replies`. */
export function mockReplyToComment(
  owner: string,
  repo: string,
  number: number,
  commentId: number,
  body: unknown,
  options: MockOptions = {}
): void {
  server.use(
    http.post(
      `${API_ROOT}/repos/${owner}/${repo}/pulls/${number}/comments/${commentId}/replies`,
      async ({ request }) => {
        await recordRequest(request);
        return jsonResponse({ body, status: 201, ...options });
      }
    )
  );
}

/** `DELETE /repos/{o}/{r}/pulls/comments/{id}`. */
export function mockDeleteComment(
  owner: string,
  repo: string,
  commentId: number,
  options: MockOptions = {}
): void {
  server.use(
    http.delete(
      `${API_ROOT}/repos/${owner}/${repo}/pulls/comments/${commentId}`,
      async ({ request }) => {
        await recordRequest(request);
        return new HttpResponse(null, { status: options.status ?? 204 });
      }
    )
  );
}

/** `POST /repos/{o}/{r}/pulls/{n}/reviews`. */
export function mockSubmitReview(
  owner: string,
  repo: string,
  number: number,
  body: unknown,
  options: MockOptions = {}
): void {
  server.use(
    http.post(
      `${API_ROOT}/repos/${owner}/${repo}/pulls/${number}/reviews`,
      async ({ request }) => {
        await recordRequest(request);
        return jsonResponse({ body, ...options });
      }
    )
  );
}

/** `POST /repos/{o}/{r}/pulls/{n}/reviews/{id}/events`, the pending review's verdict. */
export function mockSubmitReviewEvents(
  owner: string,
  repo: string,
  number: number,
  reviewId: number,
  body: unknown,
  options: MockOptions = {}
): void {
  server.use(
    http.post(
      `${API_ROOT}/repos/${owner}/${repo}/pulls/${number}/reviews/${reviewId}/events`,
      async ({ request }) => {
        await recordRequest(request);
        return jsonResponse({ body, ...options });
      }
    )
  );
}

/**
 * `GET /repos/{o}/{r}/pulls/{n}/files`, paged. `pages` maps a 1-based page
 * number to its answer; a page with no entry is a 500 that says so.
 */
export function mockPullFiles(
  owner: string,
  repo: string,
  number: number,
  pages: Record<number, JsonLeg>
): void {
  server.use(
    http.get(
      `${API_ROOT}/repos/${owner}/${repo}/pulls/${number}/files`,
      async ({ request }) => {
        await recordRequest(request);
        const page = Number(new URL(request.url).searchParams.get('page') ?? 1);
        const leg = pages[page];
        if (leg == null) return unscripted(request, `page ${page} of`);
        return jsonResponse(leg);
      }
    )
  );
}

/** `GET /repos/{o}/{r}/contents/{path}`, the raw media type. */
export function mockContents(
  owner: string,
  repo: string,
  body: string,
  options: MockOptions = {}
): void {
  server.use(
    http.get(
      `${API_ROOT}/repos/${owner}/${repo}/contents/*`,
      async ({ request }) => {
        await recordRequest(request);
        return textResponse({ body, ...options });
      }
    )
  );
}

/** `GET /repos/{o}/{r}/compare/{base}...{head}` — JSON or diff media type. */
export function mockCompareEndpoint(
  owner: string,
  repo: string,
  legs: { json?: JsonLeg; diff?: TextLeg }
): void {
  server.use(
    http.get(
      `${API_ROOT}/repos/${owner}/${repo}/compare/*`,
      async ({ request }) => {
        await recordRequest(request);
        if (request.headers.get('accept')?.includes('github.diff')) {
          if (legs.diff == null) return unscripted(request, 'diff of');
          return textResponse(legs.diff);
        }
        if (legs.json == null) return unscripted(request, 'JSON of');
        return jsonResponse(legs.json);
      }
    )
  );
}

/** `GET /repos/{o}/{r}/issues/{n}/comments`, the remarks under a description. */
export function mockIssueComments(
  owner: string,
  repo: string,
  number: number,
  body: unknown
): void {
  server.use(
    http.get(
      `${API_ROOT}/repos/${owner}/${repo}/issues/${number}/comments`,
      async ({ request }) => {
        await recordRequest(request);
        return jsonResponse({ body });
      }
    )
  );
}

/** `GET /repos/{o}/{r}/pulls/{n}/reviews`, every review submitted. */
export function mockPullReviews(
  owner: string,
  repo: string,
  number: number,
  body: unknown
): void {
  server.use(
    http.get(
      `${API_ROOT}/repos/${owner}/${repo}/pulls/${number}/reviews`,
      async ({ request }) => {
        await recordRequest(request);
        return jsonResponse({ body });
      }
    )
  );
}

/** `POST /repos/{o}/{r}/issues`. */
export function mockCreateIssue(
  owner: string,
  repo: string,
  body: unknown,
  options: MockOptions = {}
): void {
  server.use(
    http.post(
      `${API_ROOT}/repos/${owner}/${repo}/issues`,
      async ({ request }) => {
        await recordRequest(request);
        return jsonResponse({ body, status: 201, ...options });
      }
    )
  );
}

/** A 200 carrying a GraphQL `data` payload. */
export function graphQLData(data: unknown): HttpResponse<DefaultBodyType> {
  return HttpResponse.json({ data });
}

/** A 200 carrying GraphQL `errors` — how GitHub reports a bad query. */
export function graphQLErrors(
  ...messages: string[]
): HttpResponse<DefaultBodyType> {
  return HttpResponse.json({
    errors: messages.map((message) => ({ message })),
  });
}

export type GraphQLResponder = (call: GraphQLCall) => unknown;

/**
 * Routes one GraphQL call by a substring of its query, first match wins. The
 * forge's operations are told apart this way: 'pullRequests' is the open-pulls
 * list, 'viewerLatestReview' the verdict, 'viewerViewedState' the marks,
 * 'markFileAsViewed' / 'unmarkFileAsViewed' the two mutations (the unmark
 * string contains the mark one, so it must be routed first), and '{ id }' the
 * node-id read. A responder's plain object becomes `{ data }`; an
 * `HttpResponse` is used as-is.
 */
export function graphQLRoute(
  ...routes: [
    match: string,
    respond: (variables: Record<string, unknown>) => unknown,
  ][]
): GraphQLResponder {
  return ({ query, variables }) => {
    for (const [match, respond] of routes) {
      if (query.includes(match)) {
        const result = respond(variables);
        return result instanceof HttpResponse ? result : graphQLData(result);
      }
    }
    return graphQLErrors(`Unscripted GraphQL operation: ${query.slice(0, 80)}`);
  };
}

/** `POST /graphql`. */
export function mockGraphQL(respond: GraphQLResponder): void {
  server.use(
    http.post(`${API_ROOT}/graphql`, async ({ request }) => {
      await recordRequest(request);
      const call = (await request.clone().json()) as GraphQLCall;
      const result = respond(call);
      return result instanceof HttpResponse ? result : graphQLData(result);
    })
  );
}

/** `GET https://github.com/{webPath}.diff`, the web host's plain-text diff. */
export function mockWebDiff(
  webPath: string,
  options: { body?: string } & MockOptions = {}
): void {
  server.use(
    http.get(`${WEB_ROOT}${webPath}.diff`, async ({ request }) => {
      await recordRequest(request);
      return textResponse({ body: options.body ?? '', ...options });
    })
  );
}

/** `GET https://raw.githubusercontent.com/{o}/{r}/{ref}/{path}`. */
export function mockWebRaw(
  owner: string,
  repo: string,
  body: string,
  options: MockOptions = {}
): void {
  server.use(
    http.get(`${RAW_ROOT}/${owner}/${repo}/*`, async ({ request }) => {
      await recordRequest(request);
      return textResponse({ body, ...options });
    })
  );
}

/**
 * `GET {root}{path}` on an image host the media proxy fetches — the web
 * host's `/owner/repo/assets/…` and, after a redirect, the JWT-signed
 * private image host alike. A redirect leg passes `location` in `headers`.
 */
export function mockImageHost(
  root: string,
  path: string,
  body: string,
  options: MockOptions = {}
): void {
  server.use(
    http.get(`${root}${path}`, async ({ request }) => {
      await recordRequest(request);
      return textResponse({ body, ...options });
    })
  );
}
