import { RPCHandler } from '@orpc/server/fetch';
import { createFileRoute } from '@tanstack/react-router';

import { withEvlog } from '@/lib/logger';
import { router } from '@/lib/rpc/router';
import { readGitHubToken } from '@/lib/server/github';

// Every JSON call the app makes, under one path. The diff is not here: it is a
// patch of up to tens of megabytes that the route pipes straight from GitHub to
// the browser, and an RPC envelope would make the Worker hold all of it in
// memory and JSON-escape it first. See `src/routes/api/diff.ts`.
//
// The token is read once, here, and handed to the procedures as context, so no
// procedure has to know it arrives on a header.

const handler = new RPCHandler(router);

const serve = withEvlog(async ({ request }: { request: Request }) => {
  const { matched, response } = await handler.handle(request, {
    prefix: '/api/rpc',
    context: { token: readGitHubToken(request) },
  });
  return matched
    ? response
    : new Response('No such procedure.', { status: 404 });
});

export const Route = createFileRoute('/api/rpc/$')({
  server: { handlers: { GET: serve, POST: serve } },
});
