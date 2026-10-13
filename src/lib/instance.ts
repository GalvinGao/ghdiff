// What this deployment serves, as one fact the page is born knowing.
//
// The client used to ask for it over RPC after mount, which put a fact about
// the deployment behind the session's own pipeline: a grant past its hours
// answered every procedure 401, this one included, and a connect dialog read
// the failure as "no GitLab hosts configured". The answer needs no credential,
// so it no longer travels where one is checked. The root loader calls this
// server function for the first paint — in the same process on the server,
// which is the thing a loader on workerd cannot do over HTTP — and every
// screen reads it out of the route's data, certain from the first render.
//
// Two names travel with it. `brand` is what the deployment calls itself —
// `GHDIFF_BRANDING`, or ghdiff.com — and labels the home page's heading and
// the way home. `host` is where the request arrived, which is what an address
// pasted here or shown as an example has to name. Both ride the loader so the
// server markup and the first client render cannot disagree.

import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';

import type { InstanceInfo } from '@/lib/forges';
import { instanceInfoFromConfig } from '@/lib/server/instance';
import { configMiddleware } from '@/lib/server/middleware';
import { externalOrigin } from '@/lib/server/origin';

/** The root loader's data: what this deployment serves, its brand, and its host. */
export type InstanceLoaderData = InstanceInfo & { brand: string; host: string };

/**
 * What this deployment serves, as one server function. On the server it runs
 * in the same process, so SSR answers it without fetching this zone; in the
 * browser it rides Start's own server-function endpoint, which shares nothing
 * with the RPC route's credential pipeline.
 */
export const getInstanceInfo = createServerFn({ method: 'GET' })
  .middleware([configMiddleware])
  .handler(({ context }): InstanceLoaderData => {
    const host = new URL(externalOrigin(getRequest())).host;
    return {
      ...instanceInfoFromConfig(context.config),
      brand: context.config.branding,
      host,
    };
  });
