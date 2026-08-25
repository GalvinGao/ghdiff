import { createEvlog } from 'evlog/next';

/** The fields reviewer attaches to a request event. */
export interface RequestFields extends Record<string, unknown> {}

// One evlog instance for the whole server. Wrap every route handler in
// `withEvlog` so each request emits exactly one wide event, then call
// `requestLog().set({...})` inside the handler to attach the fields that
// describe what the request actually did.
const evlog = createEvlog({
  service: 'reviewer',
  env: {
    environment: process.env.NODE_ENV ?? 'development',
  },
});

export const { createEvlogError, log, withEvlog } = evlog;

/** The request-scoped logger, typed for reviewer's field set. */
export function requestLog() {
  return evlog.useLogger<RequestFields>();
}

/** evlog.error accepts a string or an Error, so unknown causes are coerced. */
export function toLoggable(cause: unknown): Error | string {
  if (cause instanceof Error) return cause;
  return typeof cause === 'string' ? cause : JSON.stringify(cause);
}
