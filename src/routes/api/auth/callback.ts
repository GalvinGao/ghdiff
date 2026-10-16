import { createFileRoute } from '@tanstack/react-router';

import {
  type AuthFailure,
  authFailureUrl,
  callbackUrl,
} from '@/lib/github/app';
import { toLoggable } from '@/lib/logger';
import { notConfigured, redirectTo } from '@/lib/server/authRoute';
import { gitLabHostFor } from '@/lib/server/config';
import { exchangeCode } from '@/lib/server/github/app';
import { exchangeGitLabCode } from '@/lib/server/gitlab/oauth';
import { sessionMiddleware } from '@/lib/server/middleware';
import { externalRequestUrl } from '@/lib/server/origin';
import { withGitLabGrant } from '@/lib/session';

// Where the forge sends the reviewer back. It spends the code and seals the
// session.
//
// The handoff cookie is spent whatever happens, on the first line of the answer:
// its `state` and its verifier are each good for exactly one callback, and a
// second attempt has to start from the beginning. Every path out of here
// therefore carries `clearHandoff()`.
//
// Four things are checked before the forge is asked anything, and each has its
// own reason on the way out. The handoff must be there, which it is not if the
// reviewer sat on the consent page for ten minutes. The forge must not have said
// the reviewer declined. There must be a code. And the `state` must be the one
// this app put aside — that comparison is the whole of the CSRF defence here,
// since a code arriving with somebody else's `state` is somebody else trying to
// hand this browser their session.

export const Route = createFileRoute('/api/auth/callback')({
  server: {
    middleware: [sessionMiddleware],
    handlers: {
      GET: async ({
        request,
        context: { log, config, keyring, seal, session },
      }) => {
        if (keyring == null) {
          log.set({ outcome: 'not-configured' });
          return notConfigured();
        }

        const spent = seal.clearHandoff();
        const handoff = await seal.readHandoff(request);
        const params = new URL(request.url).searchParams;

        function failed(reason: AuthFailure): Response {
          log.set({ outcome: 'failed', reason });
          return redirectTo(authFailureUrl(handoff?.returnTo ?? '/', reason), [
            spent,
          ]);
        }

        if (handoff == null) return failed('expired');
        // The forge says so itself when the reviewer pressed Cancel, and that
        // is not a failure of this app to report as one.
        if (params.get('error') != null) return failed('denied');

        const code = params.get('code');
        const state = params.get('state');
        if (code == null || state == null) return failed('mismatch');
        if (state !== handoff.state) {
          log.set({ stateMatched: false });
          return failed('mismatch');
        }

        const now = Date.now();

        if (handoff.forge === 'gitlab') {
          const host = handoff.host;
          const instance =
            host == null ? undefined : gitLabHostFor(config, host);
          if (host == null || instance == null) {
            log.set({ outcome: 'not-configured', forge: 'gitlab', host });
            return failed('gitlab');
          }
          try {
            const grant = await exchangeGitLabCode({
              host,
              instance,
              code,
              redirectUri: callbackUrl(externalRequestUrl(request)),
              verifier: handoff.verifier,
              now,
            });
            // The session may already exist — a GitHub sign-in, or another
            // GitLab host. The new grant joins it rather than replacing it.
            const existing = session;
            log.set({ outcome: 'signed-in', forge: 'gitlab', host });
            return redirectTo(handoff.returnTo, [
              spent,
              await seal.writeSession(
                withGitLabGrant(existing, host, grant, now),
                now
              ),
            ]);
          } catch (error) {
            log.error(toLoggable(error), {
              step: 'exchange-code',
              forge: 'gitlab',
            });
            return failed('gitlab');
          }
        }

        const app = config.github.app;
        if (app == null) {
          log.set({ outcome: 'not-configured' });
          return notConfigured();
        }

        try {
          const grant = await exchangeCode({
            code,
            config: app,
            now,
            redirectUri: callbackUrl(externalRequestUrl(request)),
            verifier: handoff.verifier,
          });
          // The session may already hold GitLab connections, and a sign-in
          // here costs none of them: the GitHub grant joins the cookie the
          // same way a GitLab grant does above.
          const existing = session;
          log.set({
            outcome: 'signed-in',
            returnTo: handoff.returnTo,
            expiring: grant.accessExpiresAt != null,
          });
          return redirectTo(handoff.returnTo, [
            spent,
            // `issuedAt` is the session's own, or now for a session that
            // starts here: a refresh carries this same moment forward, so the
            // ceiling is measured from the sign-in.
            await seal.writeSession(
              {
                ...existing,
                github: grant,
                issuedAt: existing?.issuedAt ?? now,
              },
              now
            ),
          ]);
        } catch (error) {
          // The code itself never reaches the log, here or anywhere: it is a
          // credential until it is spent, and a failed exchange is the one
          // case where it may not have been.
          log.error(toLoggable(error), { step: 'exchange-code' });
          return failed('github');
        }
      },
    },
  },
});
