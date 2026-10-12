// The one shape every plain-text answer of this server takes: text/plain
// and no-store, whether the body is a route's failure sentence or a forge's
// streamed diff. When a fallback could not carry the whole diff the notice
// header says so, and the client reads that header by name — so its name is
// pinned here once, beside the only code that sets it. A failure's typed
// reason rides the `x-ghdiff-failure` headers, whose names live in
// `@/lib/failure` because the client reads them too.

import {
  FAILURE_FORGE_HEADER,
  FAILURE_HEADER,
  type FailureMeta,
} from '@/lib/failure';

/** Set when the fallback could not carry the whole diff. */
const SYNTHESIS_NOTICE_HEADER = 'x-ghdiff-notice';

/**
 * A text/plain answer that nothing may cache. The body may be a stream, so
 * the diff and file paths pay no copy for the wrapper; `notice` rides the
 * `x-ghdiff-notice` header, and `failure` rides the `x-ghdiff-failure` family
 * so the client can read the reason without parsing the sentence.
 */
export function textResponse(
  body: BodyInit | null,
  options: {
    status?: number;
    notice?: string;
    failure?: FailureMeta;
    /**
     * The source's own ETag, so the browser can ask the same source the same
     * question next time. A weak one is fine: `If-None-Match` compares weakly.
     */
    etag?: string | null;
  } = {}
): Response {
  const headers: Record<string, string> = {
    'cache-control': 'no-store',
    'content-type': 'text/plain',
  };
  if (options.notice != null) {
    headers[SYNTHESIS_NOTICE_HEADER] = options.notice;
  }
  if (options.failure != null) {
    headers[FAILURE_HEADER] = options.failure.reason;
    if (options.failure.forge != null) {
      headers[FAILURE_FORGE_HEADER] = options.failure.forge;
    }
  }
  if (options.etag != null) {
    headers.etag = options.etag;
  }
  return new Response(body, { status: options.status ?? 200, headers });
}

/**
 * The forge's answer to a conditional read, passed on: a 304 goes out as a
 * 304 with no body — the browser's stored copy is current, and nothing is read
 * or sent twice — and anything else streams with the source's ETag beside it.
 */
export function conditionalResponse(
  response: Response,
  options: { notice?: string } = {}
): Response {
  const etag = response.headers.get('etag');
  if (response.status === 304) {
    return textResponse(null, { status: 304, etag });
  }
  return textResponse(response.body, { ...options, etag });
}
