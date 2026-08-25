import { createEvlog } from 'evlog/next';

// One evlog instance for the whole server. Wrap every route handler in
// `withEvlog` so each request emits exactly one wide event, then call
// `useLogger().set({...})` inside the handler to attach the fields that
// describe what the request actually did.
export const { createEvlogError, log, useLogger, withEvlog } = createEvlog({
  service: 'reviewer',
  env: {
    environment: process.env.NODE_ENV ?? 'development',
  },
});
