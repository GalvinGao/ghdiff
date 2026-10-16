import { createFileRoute } from '@tanstack/react-router';

import template from '@/lib/server/ghdiff.user.js?raw';
import { configMiddleware } from '@/lib/server/middleware';
import { externalOrigin } from '@/lib/server/origin';
import { buildUserscript } from '@/lib/server/userscript';

// The userscript, filled for this deployment: one `@match` per host served,
// and the origin the request arrived on as the button's target and the
// script's update address. It used to be a static asset the platform answered
// before the Worker ran, but a self-hosted deployment's script has to point at
// that deployment, which only the server knows. The address is the one it
// always had, so scripts already installed keep updating from it.
//
// `/ghdiff.user.js` claims a dead address: one colon-less segment parses as
// no target on either forge's grammar, the same reading `/healthz` holds.

export const Route = createFileRoute('/ghdiff.user.js')({
  server: {
    middleware: [configMiddleware],
    handlers: {
      GET: ({ request, context: { config } }) => {
        const script = buildUserscript(
          template,
          config,
          externalOrigin(request)
        );
        return new Response(script, {
          headers: {
            // The script changes with the deployment, not the build.
            'cache-control': 'no-cache',
            'content-type': 'text/javascript; charset=utf-8',
          },
        });
      },
    },
  },
});
