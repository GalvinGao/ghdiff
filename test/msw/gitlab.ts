// The msw half of the GitLab forge tests: one handler per endpoint the forge
// calls, and the header assertion every call must pass. The recorder, the
// catch-all server and the leg helpers are the shared half in `./shared.ts`.
//
// Every helper scripts one endpoint for one test through `server.use()`. A
// request nothing scripted is answered 500 by the catch-all and recorded all
// the same, so a missing mock fails with a sentence that names the request
// rather than with a bare network error.
//
// The forge is host-driven — the target names the instance — so every helper
// takes the host as its first argument and the tests exercise both gitlab.com
// and a self-hosted stand-in.

import { http, HttpResponse, type DefaultBodyType } from 'msw';
import assert from 'node:assert/strict';

import {
  type JsonLeg,
  jsonResponse,
  type MockOptions,
  type RecordedRequest,
  recordRequest,
  requests,
  server,
  type TextLeg,
  textResponse,
  unscripted,
} from './shared';
import { USER_AGENT } from '@/lib/server/github/client';

export const GITLAB_COM = 'gitlab.com';
export const GITLAB_CORP = 'gitlab.corp.com';

/**
 * The headers every call to GitLab must carry: the request names the app's
 * user agent (the hand-rolled fetchers and the forge's own gitbeaker
 * requester both set it), and the credential travels the same way on both —
 * a bearer in `authorization`, a personal access token in `private-token`,
 * and neither without a token.
 */
export function assertGitLabHeaders(
  record: RecordedRequest,
  options: { scheme?: 'bearer' | 'private-token'; token?: string } = {}
): void {
  assert.equal(record.headers['user-agent'], USER_AGENT);
  const authorization = record.headers['authorization'];
  const privateToken = record.headers['private-token'];
  if (options.token == null) {
    assert.equal(authorization, undefined, 'authorization without a token');
    assert.equal(privateToken, undefined, 'private-token without a token');
  } else if (options.scheme === 'private-token') {
    assert.equal(privateToken, options.token);
    assert.equal(
      authorization,
      undefined,
      'authorization beside private-token'
    );
  } else {
    assert.equal(authorization, `Bearer ${options.token}`);
    assert.equal(privateToken, undefined, 'private-token beside bearer');
  }
}

/** GitLab answers its text endpoints' failures with a JSON body. */
export function jsonBody(body: unknown): string {
  return JSON.stringify(body);
}

export const JSON_CONTENT_TYPE: Record<string, string> = {
  'content-type': 'application/json',
};

function api(host: string): string {
  return `https://${host}/api/v4`;
}

/** `GET /user`, who the credential belongs to. */
export function mockGetUser(host: string, leg: JsonLeg): void {
  server.use(
    http.get(`${api(host)}/user`, async ({ request }) => {
      await recordRequest(request);
      return jsonResponse(leg);
    })
  );
}

/**
 * `GET /users/:id`, one user object per id — the per-author read a comments
 * list makes for the `bot` flag the note author never carries.
 */
export function mockUserById(
  host: string,
  legs: Record<number, JsonLeg>
): void {
  server.use(
    http.get(`${api(host)}/users/:id`, async ({ request, params }) => {
      await recordRequest(request);
      const leg = legs[Number(params.id)];
      if (leg == null) return unscripted(request, `user ${String(params.id)}`);
      return jsonResponse(leg);
    })
  );
}

/**
 * `GET /projects/:project/merge_requests/:iid/raw_diffs`, the hand-rolled
 * plain-text stream. The project segment arrives `%2F`-encoded; the recorded
 * request is where a test asserts that.
 */
export function mockMrRawDiffs(host: string, leg: TextLeg): void {
  server.use(
    http.get(
      `${api(host)}/projects/:project/merge_requests/:iid/raw_diffs`,
      async ({ request }) => {
        await recordRequest(request);
        return textResponse(leg);
      }
    )
  );
}

/**
 * `GET /projects/:project/merge_requests/:iid/diffs`, the JSON per-file list
 * gitbeaker pages through. `pages` maps a 1-based page number to its answer;
 * a page with no entry is a 500 that says so.
 */
export function mockMrDiffs(
  host: string,
  pages: Record<number, JsonLeg>
): void {
  server.use(
    http.get(
      `${api(host)}/projects/:project/merge_requests/:iid/diffs`,
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

/** `GET /projects/:project`, the visibility probe behind `/api/resolve`. */
export function mockProjectShow(host: string, leg: JsonLeg): void {
  server.use(
    http.get(`${api(host)}/projects/:project`, async ({ request }) => {
      await recordRequest(request);
      return jsonResponse(leg);
    })
  );
}

/** `GET /projects/:project/merge_requests/:iid`, the MR's own detail. */
export function mockMrShow(host: string, leg: JsonLeg): void {
  server.use(
    http.get(
      `${api(host)}/projects/:project/merge_requests/:iid`,
      async ({ request }) => {
        await recordRequest(request);
        return jsonResponse(leg);
      }
    )
  );
}

/**
 * `GET /projects/:project/repository/commits/:sha/diff`, paged the same way
 * the MR diffs are.
 */
export function mockCommitDiff(
  host: string,
  pages: Record<number, JsonLeg>
): void {
  server.use(
    http.get(
      `${api(host)}/projects/:project/repository/commits/:sha/diff`,
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

/** `GET /projects/:project/repository/compare?from=…&to=…`. */
export function mockCompare(host: string, leg: JsonLeg): void {
  server.use(
    http.get(
      `${api(host)}/projects/:project/repository/compare`,
      async ({ request }) => {
        await recordRequest(request);
        return jsonResponse(leg);
      }
    )
  );
}

/** `GET /projects/:project/repository/files/:file/raw?ref=…`, hand-rolled. */
export function mockFileRaw(host: string, leg: TextLeg): void {
  server.use(
    http.get(
      `${api(host)}/projects/:project/repository/files/:file/raw`,
      async ({ request }) => {
        await recordRequest(request);
        return textResponse(leg);
      }
    )
  );
}

/**
 * `GET /projects/:project/uploads/:secret/:filename`, the markdown uploads
 * download API — where the media proxy fetches an upload, since the web
 * paths answer only to a browser session.
 */
export function mockMarkdownUpload(host: string, leg: TextLeg): void {
  server.use(
    http.get(
      `${api(host)}/projects/:project/uploads/:secret/:filename`,
      async ({ request }) => {
        await recordRequest(request);
        return textResponse(leg);
      }
    )
  );
}

/**
 * `GET <path>` on the instance's web host — an upload the media proxy
 * fetches, which lives under the project's own path and not under /api/v4.
 * `path` starts with `/`; a redirect leg passes `location` in `headers`.
 */
export function mockUpload(host: string, path: string, leg: TextLeg): void {
  server.use(
    http.get(`https://${host}${path}`, async ({ request }) => {
      await recordRequest(request);
      return textResponse(leg);
    })
  );
}

/**
 * `GET /projects/:project/merge_requests/:iid/discussions`, paged the same
 * way the MR diffs are.
 */
export function mockMrDiscussions(
  host: string,
  pages: Record<number, JsonLeg>
): void {
  server.use(
    http.get(
      `${api(host)}/projects/:project/merge_requests/:iid/discussions`,
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

/**
 * `POST /projects/:project/merge_requests/:iid/discussions/:discussionId/notes`,
 * a reply onto an existing thread.
 */
export function mockDiscussionAddNote(host: string, leg: JsonLeg): void {
  server.use(
    http.post(
      `${api(host)}/projects/:project/merge_requests/:iid/discussions/:discussionId/notes`,
      async ({ request }) => {
        await recordRequest(request);
        return jsonResponse({ status: 201, ...leg });
      }
    )
  );
}

/**
 * `POST /projects/:project/merge_requests/:iid/discussions`, a new
 * positioned diff note. gitbeaker sends the position as multipart form
 * fields; the recorded body carries one entry per field.
 */
export function mockDiscussionCreate(host: string, leg: JsonLeg): void {
  server.use(
    http.post(
      `${api(host)}/projects/:project/merge_requests/:iid/discussions`,
      async ({ request }) => {
        await recordRequest(request);
        return jsonResponse({ status: 201, ...leg });
      }
    )
  );
}

/** `POST /projects/:project/merge_requests/:iid/notes`, a plain note. */
export function mockMrNoteCreate(host: string, leg: JsonLeg): void {
  server.use(
    http.post(
      `${api(host)}/projects/:project/merge_requests/:iid/notes`,
      async ({ request }) => {
        await recordRequest(request);
        return jsonResponse({ status: 201, ...leg });
      }
    )
  );
}

/**
 * `PUT /projects/:project/merge_requests/:iid/discussions/:discussionId?resolved=…`,
 * the resolve mark on a thread.
 */
export function mockDiscussionResolve(
  host: string,
  leg: JsonLeg = { body: {} }
): void {
  server.use(
    http.put(
      `${api(host)}/projects/:project/merge_requests/:iid/discussions/:discussionId`,
      async ({ request }) => {
        await recordRequest(request);
        return jsonResponse(leg);
      }
    )
  );
}

/** `DELETE /projects/:project/merge_requests/:iid/notes/:noteId`. */
export function mockMrNoteRemove(
  host: string,
  options: MockOptions = {}
): void {
  server.use(
    http.delete(
      `${api(host)}/projects/:project/merge_requests/:iid/notes/:noteId`,
      async ({ request }) => {
        await recordRequest(request);
        return new HttpResponse(null, { status: options.status ?? 204 });
      }
    )
  );
}

/**
 * `GET /projects/:project/merge_requests`, the open-MR list. `legs` maps a
 * project path (`group/repo`, decoded) to its answer — either one answer for
 * every page, or one per 1-based page number. A project or page with no
 * entry is a 500 that says so.
 */
export function mockMrList(
  host: string,
  legs: Record<string, JsonLeg | Record<number, JsonLeg>>
): void {
  server.use(
    http.get(
      `${api(host)}/projects/:project/merge_requests`,
      async ({ request, params }) => {
        await recordRequest(request);
        const leg = legs[String(params.project)];
        if (leg == null) {
          return unscripted(
            request,
            `merge requests of ${String(params.project)}`
          );
        }
        if ('body' in leg) return jsonResponse(leg);
        const page = Number(new URL(request.url).searchParams.get('page') ?? 1);
        const pageLeg = leg[page];
        if (pageLeg == null) return unscripted(request, `page ${page} of`);
        return jsonResponse(pageLeg);
      }
    )
  );
}

/**
 * `GET /projects/:project/merge_requests/:iid/approvals`, the all-tiers
 * approval configuration — the `approval_state` endpoint exists only on EE.
 * `legs` maps an iid to its answer; an iid with no entry is a 500 that says
 * so.
 */
export function mockApprovals(
  host: string,
  legs: Record<string | number, JsonLeg>
): void {
  server.use(
    http.get(
      `${api(host)}/projects/:project/merge_requests/:iid/approvals`,
      async ({ request, params }) => {
        await recordRequest(request);
        const leg = legs[String(params.iid)];
        if (leg == null) {
          return unscripted(request, `approvals of !${String(params.iid)}`);
        }
        return jsonResponse(leg);
      }
    )
  );
}

/** `POST /projects/:project/merge_requests/:iid/approve`. */
export function mockApprove(host: string, leg: JsonLeg): void {
  server.use(
    http.post(
      `${api(host)}/projects/:project/merge_requests/:iid/approve`,
      async ({ request }) => {
        await recordRequest(request);
        return jsonResponse({ status: 201, ...leg });
      }
    )
  );
}

/**
 * `GET /projects/:project/merge_requests/:iid/draft_notes`, the credential's
 * own drafts, paged the same way the discussions are.
 */
export function mockDraftNotes(
  host: string,
  pages: Record<number, JsonLeg>
): void {
  server.use(
    http.get(
      `${api(host)}/projects/:project/merge_requests/:iid/draft_notes`,
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

/**
 * `POST /projects/:project/merge_requests/:iid/draft_notes`, a new positioned
 * draft. gitbeaker sends the position as multipart form fields, the same way
 * it sends a discussion's.
 */
export function mockDraftNoteCreate(host: string, leg: JsonLeg): void {
  server.use(
    http.post(
      `${api(host)}/projects/:project/merge_requests/:iid/draft_notes`,
      async ({ request }) => {
        await recordRequest(request);
        return jsonResponse({ status: 201, ...leg });
      }
    )
  );
}

/** `POST /projects/:project/merge_requests/:iid/draft_notes/bulk_publish`. */
export function mockDraftNotesBulkPublish(host: string, leg: JsonLeg): void {
  server.use(
    http.post(
      `${api(host)}/projects/:project/merge_requests/:iid/draft_notes/bulk_publish`,
      async ({ request }) => {
        await recordRequest(request);
        return jsonResponse({ status: 201, ...leg });
      }
    )
  );
}

/** `DELETE /projects/:project/merge_requests/:iid/draft_notes/:draftNoteId`. */
export function mockDraftNoteRemove(
  host: string,
  options: MockOptions = {}
): void {
  server.use(
    http.delete(
      `${api(host)}/projects/:project/merge_requests/:iid/draft_notes/:draftNoteId`,
      async ({ request }) => {
        await recordRequest(request);
        return new HttpResponse(null, { status: options.status ?? 204 });
      }
    )
  );
}

// --- The reads beside the forge's own: reviewers, history, deployments ----------

/** One scripted GET under the instance's REST API, recorded and answered. */
function mockGet(host: string, path: string, leg: JsonLeg): void {
  server.use(
    http.get(`${api(host)}${path}`, async ({ request }) => {
      await recordRequest(request);
      return jsonResponse(leg);
    })
  );
}

/** `GET /projects/:project/merge_requests/:iid/reviewers`. */
export function mockMrReviewers(host: string, leg: JsonLeg): void {
  mockGet(host, '/projects/:project/merge_requests/:iid/reviewers', leg);
}

/** `GET /projects/:project/merge_requests/:iid/notes`, one page of them. */
export function mockMrNotes(host: string, leg: JsonLeg): void {
  mockGet(host, '/projects/:project/merge_requests/:iid/notes', leg);
}

/** `GET /projects/:project/merge_requests/:iid/commits`, newest first. */
export function mockMrCommits(host: string, leg: JsonLeg): void {
  mockGet(host, '/projects/:project/merge_requests/:iid/commits', leg);
}

/** `GET /projects/:project/repository/commits/:sha`, one commit. */
export function mockCommitShow(host: string, leg: JsonLeg): void {
  mockGet(host, '/projects/:project/repository/commits/:sha', leg);
}

/** `GET /projects/:project/repository/merge_base`. */
export function mockMergeBase(host: string, leg: JsonLeg): void {
  mockGet(host, '/projects/:project/repository/merge_base', leg);
}

/** `GET /projects/:project/deployments`, the newest page. */
export function mockDeployments(host: string, leg: JsonLeg): void {
  mockGet(host, '/projects/:project/deployments', leg);
}

/** `POST /projects/:project/issues`. */
export function mockIssueCreate(host: string, leg: JsonLeg): void {
  server.use(
    http.post(`${api(host)}/projects/:project/issues`, async ({ request }) => {
      await recordRequest(request);
      return jsonResponse({ status: 201, ...leg });
    })
  );
}

// --- GraphQL ---------------------------------------------------------------------

export interface GitLabGraphQLCall {
  query: string;
  variables: Record<string, unknown>;
}

/** A 200 carrying a GraphQL `data` payload. */
export function graphQLData(data: unknown): HttpResponse<DefaultBodyType> {
  return HttpResponse.json({ data });
}

/** A 200 carrying GraphQL `errors` — how GitLab reports a query it cannot run. */
export function graphQLErrors(
  ...messages: string[]
): HttpResponse<DefaultBodyType> {
  return HttpResponse.json({
    errors: messages.map((message) => ({ message })),
  });
}

export type GitLabGraphQLResponder = (call: GitLabGraphQLCall) => unknown;

/**
 * Routes one GraphQL call by a substring of its query, first match wins —
 * the operation name tells the forge's two reads apart ('OpenMergeRequests'
 * from 'MyMergeRequestApproval'). A responder's plain object becomes
 * `{ data }`; an `HttpResponse` is used as-is.
 */
export function graphQLRoute(
  ...routes: [
    match: string,
    respond: (variables: Record<string, unknown>) => unknown,
  ][]
): GitLabGraphQLResponder {
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

/** The GraphQL calls made so far against a host, with their parsed bodies. */
export function graphQLCallsTo(host: string): GitLabGraphQLCall[] {
  return requests
    .filter((record) => record.host === host && record.path === '/api/graphql')
    .map((record) => record.body as GitLabGraphQLCall);
}

/** `POST /api/graphql` — not under `/api/v4`, unlike everything above. */
export function mockGraphQL(
  host: string,
  respond: GitLabGraphQLResponder
): void {
  server.use(
    http.post(`https://${host}/api/graphql`, async ({ request }) => {
      await recordRequest(request);
      const call = (await request.clone().json()) as GitLabGraphQLCall;
      const result = respond(call);
      return result instanceof HttpResponse ? result : graphQLData(result);
    })
  );
}
