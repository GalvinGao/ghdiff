import { initLogger, type RequestLogger } from 'evlog';
import { defineFrameworkIntegration } from 'evlog/toolkit';
import { AsyncLocalStorage } from 'node:async_hooks';

export { createEvlogError, log } from 'evlog';

/** The fields ghdiff attaches to a request event. */
export interface RequestFields extends Record<string, unknown> {}

// evlog ships integrations for Next, Nitro, Hono, and others, but not for a
// TanStack Start server route. `defineFrameworkIntegration` is the seam evlog
// exposes for exactly this: ghdiff declares what to read off the handler
// context and evlog owns the request logger, the sampling, and the emit.
const storage = new AsyncLocalStorage<RequestLogger>();

// Cloudflare Workers logs an object per line, so `stringify: false` keeps the
// fields queryable in the dashboard instead of collapsing them into a string.
initLogger({
  env: {
    service: 'ghdiff',
    environment: import.meta.env.MODE,
  },
  stringify: false,
});

/** The shape every TanStack Start server handler receives. */
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
  // The logger reaches the handler through `requestLog()`, not through a field
  // on the context, so there is nothing to attach.
  attachLogger: () => {},
  storage,
});

/**
 * Wraps one server route handler so the request emits exactly one wide event.
 * Call `requestLog().set({...})` inside the handler to attach the fields that
 * describe what the request actually did.
 */
export function withEvlog<TContext extends ServerHandlerContext>(
  handler: (context: TContext) => Promise<Response>
): (context: TContext) => Promise<Response> {
  return async (context) => {
    const { finish, finishResponse, runWith, skipped } =
      integration.start(context);
    if (skipped) {
      return await handler(context);
    }
    try {
      const response = await runWith(() => handler(context));
      // The diff route streams its body. `finishResponse` holds the emit until
      // the stream ends, so the event carries the whole request.
      return await finishResponse(response, { status: response.status });
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      await finish({ error });
      throw error;
    }
  };
}

/** The request-scoped logger, typed for ghdiff's field set. */
export function requestLog(): RequestLogger<RequestFields> {
  const logger = storage.getStore();
  if (logger == null) {
    throw new Error(
      '[ghdiff] requestLog() ran outside withEvlog(). Wrap the handler.'
    );
  }
  return logger as RequestLogger<RequestFields>;
}

/** evlog.error accepts a string or an Error, so unknown causes are coerced. */
export function toLoggable(cause: unknown): Error | string {
  if (cause instanceof Error) return cause;
  return typeof cause === 'string' ? cause : JSON.stringify(cause);
}
