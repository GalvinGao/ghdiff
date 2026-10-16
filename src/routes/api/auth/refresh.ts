import { createFileRoute } from '@tanstack/react-router';

import { toLoggable } from '@/lib/logger';
import { empty } from '@/lib/server/authRoute';
import { REFRESH_ALREADY_SPENT, refreshGrant } from '@/lib/server/github/app';
import { originMiddleware, sessionMiddleware } from '@/lib/server/middleware';
import { OAuthError } from '@/lib/server/oauth';
import { accessTokenFresh, refreshable, withinMaxAge } from '@/lib/session';

// The one place in this app that spends a refresh token.
//
// It is one place on purpose. GitHub's refresh token is single-use: the moment it
// is spent, it and the access token beside it stop working, and a second caller
// spending the same one gets nothing. A refresh folded into each request would
// race itself the first time a reviewer had two tabs open.
//
// Two answers make that race harmless, and neither needs a lock or a store.
//
// A refresh that is not needed answers 204 and writes no cookie. So the tab that
// arrives a moment after another one has already refreshed finds a live token in
// the cookie the browser now holds, and is told there is nothing to do.
//
// A refresh that GitHub refuses with `bad_refresh_token` also answers 204 and
// writes no cookie. That answer means somebody spent this refresh token already,
// and the overwhelmingly likely somebody is another tab whose new cookie the
// browser is holding right now — a cookie this request cannot see, because the
// browser sent the old one before the new one existed. So this route breaks
// nothing and lets the caller retry, and the retry carries the newer cookie. In
// the other case — a refresh token spent where this browser will never see the
// result, revoked at github.com or taken — the retry carries the same dead
// cookie and this server answers it 401 again, and `withRefresh` ends the
// session on that second 401: it is the one place that sees both answers. The
// wrong guess costs one request; the opposite wrong guess would sign a reviewer
// out for having two tabs open.
//
// Every other failure clears the session. A reviewer past the ceiling, one with
// no refresh token, and one GitHub will not answer for have nothing left to
// refresh, and 401 is what tells the client to stop trying.

export const Route = createFileRoute('/api/auth/refresh')({
  server: {
    middleware: [originMiddleware, sessionMiddleware],
    handlers: {
      POST: async ({ context: { log, config, keyring, seal, session } }) => {
        if (keyring == null) {
          log.set({ outcome: 'not-configured' });
          return empty(501);
        }

        const now = Date.now();
        if (session == null || !withinMaxAge(session, now)) {
          log.set({ outcome: 'no-session' });
          return empty(401, [seal.clearSession()]);
        }

        // `accessTokenFresh` asks with the skew; a grant five minutes from its
        // expiry still counts as needing one.
        const github = session.github;
        if (github == null || accessTokenFresh(github, now)) {
          log.set({ outcome: 'already-fresh' });
          return empty(204);
        }

        const refreshToken = github.refreshToken;
        const app = config.github.app;
        if (app == null || refreshToken == null || !refreshable(github, now)) {
          log.set({ outcome: 'not-refreshable' });
          return empty(401, [seal.clearSession()]);
        }

        try {
          const grant = await refreshGrant({ config: app, now, refreshToken });
          log.set({ outcome: 'refreshed' });
          return empty(204, [
            // `issuedAt` carried forward, so a refresh does not extend the
            // ceiling.
            await seal.writeSession(
              { github: grant, issuedAt: session.issuedAt },
              now
            ),
          ]);
        } catch (error) {
          if (
            error instanceof OAuthError &&
            error.code === REFRESH_ALREADY_SPENT
          ) {
            log.set({ outcome: 'lost-race' });
            return empty(204);
          }
          log.error(toLoggable(error), { step: 'refresh-token' });
          log.set({ outcome: 'refresh-failed' });
          return empty(401, [seal.clearSession()]);
        }
      },
    },
  },
});
