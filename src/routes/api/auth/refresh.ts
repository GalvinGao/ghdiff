import { createFileRoute } from '@tanstack/react-router';

import { requestLog, toLoggable, withEvlog } from '@/lib/logger';
import { empty, readAuthSetup } from '@/lib/server/authRoute';
import {
  GitHubAuthError,
  REFRESH_ALREADY_SPENT,
  refreshGrant,
} from '@/lib/server/githubApp';
import { clearSession, readSession, writeSession } from '@/lib/server/session';
import {
  accessTokenFresh,
  originAllowed,
  refreshable,
  withinMaxAge,
} from '@/lib/session';

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
// the other case — a refresh token spent by somebody who should not have it —
// that retry gets 401 from GitHub and the client signs out on that instead. The
// wrong guess costs one request; the opposite wrong guess would sign a reviewer
// out for having two tabs open.
//
// Every other failure clears the session. A reviewer past the ceiling, one with
// no refresh token, and one GitHub will not answer for have nothing left to
// refresh, and 401 is what tells the client to stop trying.

const refresh = withEvlog(async ({ request }: { request: Request }) => {
  const log = requestLog();

  // `SameSite=Lax` keeps the session cookie off a cross-site POST in every
  // browser that honours it. This is the half that does not depend on one.
  if (!originAllowed(request.headers.get('origin'), request.url)) {
    log.set({ outcome: 'cross-origin' });
    return empty(403);
  }

  const setup = readAuthSetup();
  if (setup == null) {
    log.set({ outcome: 'not-configured' });
    return empty(501);
  }

  const now = Date.now();
  const session = await readSession(request, setup.keyring);
  if (session == null || !withinMaxAge(session, now)) {
    log.set({ outcome: 'no-session' });
    return empty(401, [clearSession()]);
  }

  if (accessTokenFresh(session, now)) {
    log.set({ outcome: 'already-fresh' });
    return empty(204);
  }

  const refreshToken = session.refreshToken;
  if (refreshToken == null || !refreshable(session, now)) {
    log.set({ outcome: 'not-refreshable' });
    return empty(401, [clearSession()]);
  }

  try {
    const grant = await refreshGrant({
      config: setup.config,
      now,
      refreshToken,
    });
    log.set({ outcome: 'refreshed' });
    return empty(204, [
      // `issuedAt` carried forward, so a refresh does not extend the ceiling.
      await writeSession(
        { ...grant, issuedAt: session.issuedAt },
        setup.keyring,
        now
      ),
    ]);
  } catch (error) {
    if (
      error instanceof GitHubAuthError &&
      error.code === REFRESH_ALREADY_SPENT
    ) {
      log.set({ outcome: 'lost-race' });
      return empty(204);
    }
    log.error(toLoggable(error), { step: 'refresh-token' });
    log.set({ outcome: 'refresh-failed' });
    return empty(401, [clearSession()]);
  }
});

export const Route = createFileRoute('/api/auth/refresh')({
  server: { handlers: { POST: refresh } },
});
