import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';

import { contract } from './contract.ts';
import { withRefresh } from '@/lib/authFetch';

// The browser's half. It is built from `contract` and never from the router, so
// no path leads from a component to `@/lib/server/github`.
//
// No caller passes a credential any more. The reviewer's token is in a sealed
// cookie the browser attaches to every same-origin request itself, and this link
// is same-origin by construction — so the `token` that used to travel through
// every hook as a per-call context is gone, and with it the chance of one hook
// sending a stale one.
//
// What is left in its place is the retry. `withRefresh` re-sends a request whose
// answer was 401, once, after asking `/api/auth/refresh` — an access token lasts
// eight hours and a reviewer keeps a diff open for longer.

const link = new RPCLink({
  // A function, not a string. This module is evaluated on the server too, and
  // `window` is not there until a hook calls one of these from an effect.
  url: () => `${globalThis.location.origin}/api/rpc`,
  // The request is taken apart rather than cloned, and each attempt is built
  // fresh from the pieces. Two reasons. A body is a stream and sending reads
  // it, so one `Request` cannot go out twice. And `worker-configuration.d.ts`
  // puts Cloudflare's own generic `Request` in the global scope of this
  // project, which the DOM `fetch` in a browser module will not take — the
  // pieces are strings and bytes, and they belong to neither.
  fetch: async (request, _init, options) => {
    const headers = Object.fromEntries(request.headers.entries());
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.arrayBuffer();
    return await withRefresh(
      () =>
        fetch(request.url, {
          method: request.method,
          headers,
          body,
          signal: options.signal,
        }),
      options.signal
    );
  },
});

export const rpc: ContractRouterClient<typeof contract> =
  createORPCClient(link);

/**
 * The message to show for a failed call. oRPC hands back an `ORPCError` whose
 * message is the one the Worker wrote, so this is the same sentence the old
 * `body.error` carried, without each caller unwrapping a JSON envelope of its
 * own to find it.
 */
export function rpcErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) return cause.message;
  return fallback;
}
