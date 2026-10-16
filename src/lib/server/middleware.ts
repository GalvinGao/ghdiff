// The request-middleware chain the API routes share, declared once.
//
// `logMiddleware` starts the request's one wide event and hands the logger
// down as `context.log`; `configMiddleware` parses the deployment config at
// the request boundary and hands it down as `context.config`. A route names
// `apiMiddleware` in its `server.middleware` — or one that depends on it:
// `validate(...)`, which parses the route's input, `originMiddleware`, which
// refuses a foreign origin, `sessionMiddleware`, which reads the session
// cookie once and hands down the keyring, the seal, and the session, or
// `credentialsMiddleware`, which resolves the request's credentials from
// them — and its handler reads the typed context. Each route names its own
// middleware: there is no global chain, so page routes and `/healthz` stay
// outside the request log's scope.

import { createMiddleware } from '@tanstack/react-start';

import { startRequestLog } from '@/lib/logger';
import { empty } from '@/lib/server/authRoute';
import { parseDeploymentConfig } from '@/lib/server/config';
import { resolveCredentials } from '@/lib/server/credentials';
import { readKeyring, SessionSeal } from '@/lib/server/session';
import { originAllowed } from '@/lib/session';

// One wide event per request; provides context.log.
export const logMiddleware = createMiddleware({ type: 'request' }).server(
  async ({ request, next }) => {
    const { logger, finish, finishResponse, skipped } =
      startRequestLog(request);
    // A request filtered out of logging still gets the logger — it is a noop
    // — so `context.log` is always there for the handler.
    if (skipped) return next({ context: { log: logger } });
    try {
      const result = await next({ context: { log: logger } });
      // The diff route streams its body. `finishResponse` holds the emit until
      // the stream ends, so the event carries the whole request.
      return {
        ...result,
        response: await finishResponse(result.response, {
          status: result.response.status,
        }),
      };
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      await finish({ error });
      throw error;
    }
  }
);

// The deployment config, parsed at the request boundary; provides
// context.config.
export const configMiddleware = createMiddleware({ type: 'request' }).server(
  ({ next }) =>
    next({ context: { config: parseDeploymentConfig(process.env) } })
);

// The standard API chain under one name: log, then config.
export const apiMiddleware = createMiddleware({ type: 'request' })
  .middleware([logMiddleware, configMiddleware])
  .server(({ next }) => next());

/**
 * The 403 a mutating route answers a foreign origin with, before the handler
 * runs — or nothing when the origin is this site's own. The log line is what
 * makes the next one of these diagnosable: the origin the browser named, or
 * that it named none, beside the host this request actually reached.
 */
export const originMiddleware = createMiddleware({ type: 'request' })
  .middleware([apiMiddleware])
  .server(({ request, context, next }) => {
    const origin = request.headers.get('origin');
    if (originAllowed(origin, request.url)) return next();
    context.log.set({
      outcome: 'cross-origin',
      origin: origin ?? 'absent',
      requestHost: new URL(request.url).host,
    });
    return empty(403);
  });

// The session cookie, read once per request; provides context.keyring,
// context.seal, and context.session. The seal is built with whatever the
// keyring answered — nothing included, which is a deployment that cannot
// sign anybody in: its reads answer with nothing and its clears still work.
export const sessionMiddleware = createMiddleware({ type: 'request' })
  .middleware([apiMiddleware])
  .server(async ({ request, context, next }) => {
    const keyring = readKeyring(context.config);
    const seal = new SessionSeal(keyring);
    const session = await seal.readSession(request);
    return next({ context: { keyring, seal, session } });
  });

// The request's credentials, resolved once from the config and the session;
// provides context.credentials.
export const credentialsMiddleware = createMiddleware({ type: 'request' })
  .middleware([sessionMiddleware])
  .server(async ({ request, context, next }) => {
    const credentials = await resolveCredentials(
      context.config,
      context.session,
      request
    );
    return next({ context: { credentials } });
  });
