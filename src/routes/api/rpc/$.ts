import { RPCHandler } from '@orpc/server/fetch';
import { createFileRoute } from '@tanstack/react-router';

import type { RequestLog } from '@/lib/logger';
import { router } from '@/lib/rpc/router';
import type { DeploymentConfig } from '@/lib/server/config';
import type { ResolvedCredentials } from '@/lib/server/credentials';
import { credentialsMiddleware } from '@/lib/server/middleware';
import { m } from '@/paraglide/messages.js';

// Every JSON call the app makes, under one path. The diff is not here: it is a
// patch of up to tens of megabytes that the route pipes straight from GitHub to
// the browser, and an RPC envelope would make the Worker hold all of it in
// memory and JSON-escape it first. See `src/routes/api/diff.ts`.
//
// The middleware chain reads the deployment config and resolves the
// credentials once, here, and hands them to the procedures as context, so no
// procedure has to know one arrives in the environment and the other on a
// header or in a sealed cookie.

const handler = new RPCHandler(router);

async function serve(
  request: Request,
  {
    config,
    log,
    credentials,
  }: {
    config: DeploymentConfig;
    log: RequestLog;
    credentials: ResolvedCredentials;
  }
): Promise<Response> {
  const { matched, response } = await handler.handle(request, {
    prefix: '/api/rpc',
    context: { config, log, credentials },
  });
  return matched
    ? response
    : new Response(m.route_no_such_procedure(), { status: 404 });
}

export const Route = createFileRoute('/api/rpc/$')({
  server: {
    middleware: [credentialsMiddleware],
    handlers: {
      GET: ({ request, context }) => serve(request, context),
      POST: ({ request, context }) => serve(request, context),
    },
  },
});
