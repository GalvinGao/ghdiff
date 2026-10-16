import { initLogger, type RequestLogger } from 'evlog';
import { defineFrameworkIntegration } from 'evlog/toolkit';

export { createEvlogError, log } from 'evlog';

/** The fields ghdiff attaches to a request event. */
export interface RequestFields extends Record<string, unknown> {}

/** The request-scoped logger, typed for ghdiff's field set. */
export type RequestLog = RequestLogger<RequestFields>;

// evlog ships integrations for Next, Nitro, Hono, and others, but not for a
// TanStack Start server route. `defineFrameworkIntegration` is the seam evlog
// exposes for exactly this: ghdiff declares what to read off the handler
// context and evlog owns the request logger, the sampling, and the emit.

// Who reads the line decides its shape. On workerd the reader is the Workers
// dashboard, which queries an event's fields, so the event always goes out as
// the object itself — stringify would collapse those fields into one string.
// A Node deployment's lines are read by a person on a terminal or by a log
// collector (Loki) at the end of a pipe: pretty-printed for the one, one JSON
// object per line for the other, and a TTY is what tells the two apart —
// `NODE_ENV` cannot, because the build folds it to "production" before the
// server ever runs. `import.meta.env` exists only through the Vite pipeline;
// the tests import this module too, and there the target is absent —
// which reads as Cloudflare, the convention everywhere in this app, so tests
// log the object form.
initLogger({
  env: {
    service: 'ghdiff',
    environment: import.meta.env?.MODE ?? 'development',
  },
  ...(import.meta.env?.VITE_GHDIFF_TARGET === 'node'
    ? { pretty: process.stdout.isTTY === true }
    : { pretty: false, stringify: false }),
});

/** The shape a request middleware's options carry. */
interface ServerHandlerContext {
  request: Request;
}

const integration = defineFrameworkIntegration<ServerHandlerContext>({
  name: 'tanstack-start',
  extractRequest: ({ request }) => ({
    method: request.method,
    path: new URL(request.url).pathname,
    headers: request.headers,
    requestId: request.headers.get('x-request-id') ?? undefined,
  }),
  // The logger reaches the handler as `context.log`, injected by the request
  // middleware in `src/lib/server/middleware.ts`, so there is nothing to
  // attach here.
  attachLogger: () => {},
});

/**
 * Starts the one wide event a request emits. `logMiddleware` calls it for
 * every logged route and hands the logger down as `context.log`; the tests
 * call it for a logger to put in the RPC context. When the request is
 * filtered out of logging the handle's `skipped` is true and its logger is a
 * noop, so a caller may hand it down either way.
 */
export function startRequestLog(request: Request) {
  const { logger, finish, finishResponse, skipped } = integration.start({
    request,
  });
  return { logger: logger as RequestLog, finish, finishResponse, skipped };
}

/** evlog.error accepts a string or an Error, so unknown causes are coerced. */
export function toLoggable(cause: unknown): Error | string {
  if (cause instanceof Error) return cause;
  return typeof cause === 'string' ? cause : JSON.stringify(cause);
}
