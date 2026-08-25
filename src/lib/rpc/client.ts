import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';

import { contract } from './contract.ts';

// The browser's half. It is built from `contract` and never from the router, so
// no path leads from a component to `@/lib/server/github`.

/**
 * What a caller hands each call. The token is the reviewer's own, held in this
 * browser, and it travels on the Authorization header of that one request. It
 * is per call rather than per link because it changes while the app is running:
 * a link built around one token would keep sending it after a sign-out.
 */
export interface RpcContext extends Record<never, never> {
  token?: string;
}

const link = new RPCLink<RpcContext>({
  // A function, not a string. This module is evaluated on the server too, and
  // `window` is not there until a hook calls one of these from an effect.
  url: () => `${globalThis.location.origin}/api/rpc`,
  headers: ({ context }) =>
    context.token == null ? {} : { authorization: `Bearer ${context.token}` },
});

export const rpc: ContractRouterClient<typeof contract, RpcContext> =
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
