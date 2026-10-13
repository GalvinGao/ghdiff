import { createFileRoute } from '@tanstack/react-router';

import type { RequestLog } from '@/lib/logger';
import { toLoggable } from '@/lib/logger';
import { empty } from '@/lib/server/authRoute';
import type { DeploymentConfig } from '@/lib/server/config';
import { gitLabHostFor } from '@/lib/server/config';
import { revokeToken } from '@/lib/server/github/app';
import { revokeGitLabToken } from '@/lib/server/gitlab/oauth';
import { originMiddleware, sessionMiddleware } from '@/lib/server/middleware';
import { SessionSeal } from '@/lib/server/session';
import {
  hasCredentials,
  type SessionPayload,
  withoutGitHubGrant,
  withoutGitLabGrant,
} from '@/lib/session';

// Signing out ends the token, not just the cookie.
//
// Dropping the cookie alone would leave the access token good at the forge for
// the rest of its hours, wherever a copy of that cookie had already got to. So
// this asks each forge to forget its token first, and only then answers. It is
// one request and it is worth waiting for: this is the press a reviewer makes
// when they want the thing gone.
//
// It runs inside the request rather than in `waitUntil` for the same reason. A
// sign-out that reported success before the revocation landed would be reporting
// something it did not know.
//
// The press is either everything or one forge. With no body the session ends:
// every token is revoked and both cookies go, whatever the forges say — a
// revocation that failed is a token that outlives the session, which is a
// shame; a cookie that survived a sign-out because the revocation failed would
// be a reviewer still signed in after pressing the button, which is worse.
// With `{forge}` — and a GitLab `{host}` — only that connection goes: its
// token is revoked, what remains is resealed, and the reviewer stays signed in
// to the rest. A personal access token is not revoked — GitLab revokes those
// by hand on its own settings page, and the cookie drop is the whole of a PAT
// sign-out.

/** What a disconnect names: one forge, and for GitLab one host. */
type Disconnect = { forge: 'github' } | { forge: 'gitlab'; host: string };

/**
 * The body a disconnect carries, or nothing for a whole sign-out. A body that
 * is neither is `'invalid'`, because a request that meant something this
 * route cannot say is answered 400 rather than guessed at.
 */
async function readDisconnect(
  request: Request
): Promise<Disconnect | 'invalid' | undefined> {
  const text = await request.text();
  if (text.length === 0) return undefined;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return 'invalid';
  }
  if (typeof body !== 'object' || body == null) return 'invalid';
  const fields = body as Record<string, unknown>;
  if (fields.forge === 'github') return { forge: 'github' };
  if (fields.forge === 'gitlab' && typeof fields.host === 'string') {
    return { forge: 'gitlab', host: fields.host.toLowerCase() };
  }
  return 'invalid';
}

/**
 * One connection out of the session: its token revoked, the rest resealed.
 * When nothing remains the session is over, and the answer is the whole
 * sign-out's two cleared cookies.
 */
async function disconnectForge({
  config,
  disconnect,
  log,
  seal,
  session,
}: {
  config: DeploymentConfig;
  disconnect: Disconnect;
  log: RequestLog;
  seal: SessionSeal;
  session: SessionPayload;
}): Promise<Response> {
  let next: SessionPayload;

  if (disconnect.forge === 'github') {
    const app = config.github.app;
    if (app != null && session.github != null) {
      await revokeToken({
        accessToken: session.github.accessToken,
        config: app,
      }).catch((error) => {
        log.error(toLoggable(error), { step: 'revoke-token', forge: 'github' });
      });
    }
    next = withoutGitHubGrant(session);
    log.set({ outcome: 'disconnected', forge: 'github' });
  } else {
    const host = disconnect.host;
    const grant = session.gitlab?.[host];
    const instance = gitLabHostFor(config, host);
    if (grant?.type === 'oauth' && instance != null) {
      await revokeGitLabToken({
        host,
        instance,
        accessToken: grant.accessToken,
      }).catch((error) => {
        log.error(toLoggable(error), { step: 'revoke-token', forge: 'gitlab' });
      });
    }
    next = withoutGitLabGrant(session, host);
    log.set({ outcome: 'disconnected', forge: 'gitlab', host });
  }

  if (!hasCredentials(next)) {
    return empty(204, [seal.clearSession(), seal.clearHandoff()]);
  }
  return empty(204, [await seal.writeSession(next, Date.now())]);
}

export const Route = createFileRoute('/api/auth/signout')({
  server: {
    middleware: [originMiddleware, sessionMiddleware],
    handlers: {
      POST: async ({
        request,
        context: { log, config, keyring, seal, session },
      }) => {
        const disconnect = await readDisconnect(request);
        if (disconnect === 'invalid') {
          log.set({ outcome: 'bad-request' });
          return empty(400);
        }

        const gone = [seal.clearSession(), seal.clearHandoff()];
        if (keyring == null) {
          log.set({ outcome: 'not-configured' });
          return empty(204, gone);
        }

        if (session == null) {
          log.set({ outcome: 'no-session' });
          return empty(204, gone);
        }

        if (disconnect != null) {
          return disconnectForge({ config, disconnect, log, seal, session });
        }

        const revocations: Promise<void>[] = [];

        const app = config.github.app;
        if (app != null && session.github != null) {
          revocations.push(
            revokeToken({
              accessToken: session.github.accessToken,
              config: app,
            }).catch((error) => {
              log.error(toLoggable(error), {
                step: 'revoke-token',
                forge: 'github',
              });
            })
          );
        }

        for (const [host, grant] of Object.entries(session.gitlab ?? {})) {
          if (grant.type !== 'oauth') continue;
          const instance = gitLabHostFor(config, host);
          if (instance == null) continue;
          revocations.push(
            revokeGitLabToken({
              host,
              instance,
              accessToken: grant.accessToken,
            }).catch((error) => {
              log.error(toLoggable(error), {
                step: 'revoke-token',
                forge: 'gitlab',
              });
            })
          );
        }

        await Promise.all(revocations);
        log.set({ outcome: 'revoked' });
        return empty(204, gone);
      },
    },
  },
});
