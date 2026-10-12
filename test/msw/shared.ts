// What the two forge test harnesses share: the request recorder and the
// catch-all server it lives behind, the leg types every endpoint helper
// answers with, and the helpers both forge suites assert through.
//
// Every per-forge helper scripts one endpoint for one test through
// `server.use()`, and `resetMocks()` clears both the handlers and the
// recording between tests. A request nothing scripted is answered 500 by the
// catch-all and recorded all the same, so a missing mock fails with a
// sentence that names the request rather than with a bare network error.

import {
  http,
  HttpResponse,
  type DefaultBodyType,
  type JsonBodyType,
  type StrictRequest,
} from 'msw';
import { setupServer } from 'msw/node';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { startRequestLog } from '@/lib/logger';
import type { ReviewTarget } from '@/lib/reviewTarget';
import type { Forge, ForgeCredential } from '@/lib/server/forges/types';
import { GitHubError } from '@/lib/server/github/client';

/** One HTTP call the forge made, captured for assertions after it. */
export interface RecordedRequest {
  method: string;
  url: string;
  host: string;
  /** The URL's pathname, without the query. */
  path: string;
  /** The query, decoded. */
  query: Record<string, string>;
  /** Header names are lowercase. */
  headers: Record<string, string>;
  /** The parsed body, for calls that carried one. */
  body?: unknown;
}

/** Every call made since the last `resetMocks()`. */
export const requests: RecordedRequest[] = [];

/**
 * The body a call carried, in an assertable shape: parsed JSON for a JSON
 * body, one entry per field for the multipart form gitbeaker builds for a
 * positioned diff note, the raw text otherwise.
 */
async function recordBody(
  request: StrictRequest<DefaultBodyType>
): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.clone().formData();
    return Object.fromEntries(form.entries());
  }
  const text = await request.clone().text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function recordRequest(
  request: StrictRequest<DefaultBodyType>
): Promise<void> {
  const url = new URL(request.url);
  requests.push({
    method: request.method,
    url: request.url,
    host: url.host,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: Object.fromEntries(request.headers),
    body: await recordBody(request),
  });
}

/** The 500 the catch-all answers a request no test scripted. */
export function unscripted(
  request: StrictRequest<DefaultBodyType>,
  what?: string
): HttpResponse<DefaultBodyType> {
  const url = new URL(request.url);
  return HttpResponse.json(
    {
      message: `Unscripted request: ${what == null ? '' : `${what} `}${request.method} ${url.host}${url.pathname}`,
    },
    { status: 500 }
  );
}

export const server = setupServer(
  http.all('*', async ({ request }) => {
    await recordRequest(request);
    return unscripted(request);
  })
);

/** Clears the per-test scripting and the recording. Keeps the catch-all. */
export function resetMocks(): void {
  server.resetHandlers();
  requests.length = 0;
}

/** The calls one host received, optionally narrowed to a path prefix. */
export function requestsTo(host: string, path?: string): RecordedRequest[] {
  return requests.filter(
    (record) =>
      record.host === host && (path == null || record.path.startsWith(path))
  );
}

export interface MockOptions {
  status?: number;
  headers?: Record<string, string>;
}

export interface JsonLeg extends MockOptions {
  body: unknown;
}

export interface TextLeg extends MockOptions {
  body: string;
}

export function jsonResponse(leg: JsonLeg): HttpResponse<DefaultBodyType> {
  return HttpResponse.json(leg.body as JsonBodyType, {
    status: leg.status ?? 200,
    headers: leg.headers,
  });
}

export function textResponse(leg: TextLeg): HttpResponse<DefaultBodyType> {
  return new HttpResponse(leg.body, {
    status: leg.status ?? 200,
    headers: { 'content-type': 'text/plain', ...leg.headers },
  });
}

/**
 * Asserts the status and the message a failed call surfaces with. A string
 * `message` is pinned whole — that is for prose the forge wrote, passed
 * through untouched. App-authored copy takes a `fragment`, the piece that
 * carries its meaning: a copy pass on the sentence must not break the test.
 */
export async function expectGitHubError(
  promise: Promise<unknown>,
  expected: { status: number; message: string | { fragment: string } }
): Promise<void> {
  const error: unknown = await promise.catch((cause: unknown) => cause);
  assert.ok(
    error instanceof GitHubError,
    `expected a GitHubError, got ${String(error)}`
  );
  assert.equal(error.status, expected.status);
  if (typeof expected.message === 'string') {
    assert.equal(error.message, expected.message);
  } else {
    assert.ok(
      error.message.includes(expected.message.fragment),
      `Expected ${JSON.stringify(error.message)} to contain ${JSON.stringify(
        expected.message.fragment
      )}`
    );
  }
}

/** Runs `diff` with a request log, the way the route hands it one. */
export async function callDiff(
  forge: Forge,
  target: ReviewTarget,
  cred: ForgeCredential
): Promise<Response> {
  const { logger } = startRequestLog(new Request('http://localhost/api/diff'));
  return forge.diff(target, cred, logger);
}

/** One recorded fixture of the given forge, parsed. */
export function fixture<T>(forge: 'github', name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../fixtures/${forge}/${name}`, import.meta.url),
      'utf8'
    )
  ) as T;
}
