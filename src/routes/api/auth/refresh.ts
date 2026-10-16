import { createFileRoute } from '@tanstack/react-router';

import { empty } from '@/lib/server/authRoute';
import { originMiddleware, sessionMiddleware } from '@/lib/server/middleware';
import { forgeRefreshers, refreshSession } from '@/lib/server/refresh';
import { withinMaxAge } from '@/lib/session';

// The one place in this app that spends a refresh token.
//
// It is one place on purpose. A refresh token is single-use on either forge:
// the moment it is spent, it and the access token beside it stop working, and
// a second caller spending the same one gets nothing. A refresh folded into
// each request would race itself the first time a reviewer had two tabs open.
//
// Two answers make that race harmless, and neither needs a lock or a store.
//
// A refresh that is not needed answers 204 and writes no cookie. So the tab that
// arrives a moment after another one has already refreshed finds a live token in
// the cookie the browser now holds, and is told there is nothing to do.
//
// A refresh the forge refuses as already spent also answers 204 and writes no
// cookie. That answer means somebody spent this refresh token already, and the
// overwhelmingly likely somebody is another tab whose new cookie the browser is
// holding right now — a cookie this request cannot see, because the browser sent
// the old one before the new one existed. So this route breaks nothing and lets
// the caller retry, and the retry carries the newer cookie. In the other case —
// a refresh token spent where this browser will never see the result, revoked
// or taken — the retry carries the same dead cookie and this server answers it
// 401 again, and `withRefresh` ends the session on that second 401: it is the
// one place that sees both answers. The wrong guess costs one request; the
// opposite wrong guess would sign a reviewer out for having two tabs open.
//
// Every other failure clears the session's GitHub grant. A reviewer past the
// ceiling, one with no refresh token, and one the forge will not answer for
// have nothing left to refresh, and 401 is what tells the client to stop
// trying. A GitLab grant that fails its own refresh is dropped, and only that
// grant: the GitHub sign-in and the other hosts are none of its business. The
// drop is written even when nothing was refreshed — left in the cookie, the
// dead grant would be due again on the very next request, and a second 401 is
// the one `withRefresh` ends a session on.
//
// With one exception, and it costs the whole session. Doorkeeper answers a
// revoked or expired refresh token with the same `invalid_grant` as a spent
// one, and a stateless cookie cannot tell the two apart — so a genuinely dead
// GitLab grant takes the another-tab-won 204 above like any other. The guess
// is wrong that time: the retry carries the same dead grant, this server
// answers 401 again, and `withRefresh` ends the session on that second 401 —
// the GitHub sign-in and every host with it. The alternative is worse:
// dropping the grant on the spot would cost a two-tab reviewer a connection
// another tab had just refreshed, and a drop computed from the cookie this
// request read could clobber the fresh grant the winning tab sealed.
//
// Once anything is due, every refreshable grant is rotated, in one fixed
// order, so every refreshing request contests the same first grant; a lost
// race ends the request there, writing nothing, because the winner's cookie
// holds every grant. What each answer means is decided in
// `src/lib/server/refresh.ts`, where a test plays two tabs against each other.

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

        const result = await refreshSession({
          session,
          config,
          now,
          refreshers: forgeRefreshers(config, now),
          log,
        });
        if (result.kind === 'keep') return empty(204);
        if (result.kind === 'end') return empty(401, [seal.clearSession()]);
        return empty(204, [await seal.writeSession(result.session, now)]);
      },
    },
  },
});
