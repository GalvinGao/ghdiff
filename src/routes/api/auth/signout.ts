import { createFileRoute } from '@tanstack/react-router';

import { requestLog, toLoggable, withEvlog } from '@/lib/logger';
import { empty, readAuthSetup } from '@/lib/server/authRoute';
import { revokeToken } from '@/lib/server/githubApp';
import { clearHandoff, clearSession, readSession } from '@/lib/server/session';
import { originAllowed } from '@/lib/session';

// Signing out ends the token, not just the cookie.
//
// Dropping the cookie alone would leave the access token good at GitHub for the
// rest of its eight hours, wherever a copy of that cookie had already got to. So
// this asks GitHub to forget the token first, and only then answers. It is one
// request and it is worth waiting for: this is the press a reviewer makes when
// they want the thing gone.
//
// It runs inside the request rather than in `waitUntil` for the same reason. A
// sign-out that reported success before the revocation landed would be reporting
// something it did not know.
//
// Both cookies go, whatever GitHub says. A revocation that failed is a token
// that outlives the session, which is a shame; a cookie that survived a
// sign-out because the revocation failed would be a reviewer still signed in
// after pressing the button, which is worse. GitHub answering 404 is already
// treated as success by `revokeToken`, since a token GitHub has forgotten is the
// outcome this asked for.

const signout = withEvlog(async ({ request }: { request: Request }) => {
  const log = requestLog();
  if (!originAllowed(request.headers.get('origin'), request.url)) {
    log.set({ outcome: 'cross-origin' });
    return empty(403);
  }

  const gone = [clearSession(), clearHandoff()];
  const setup = readAuthSetup();
  if (setup == null) {
    log.set({ outcome: 'not-configured' });
    return empty(204, gone);
  }

  const session = await readSession(request, setup.keyring);
  if (session == null) {
    log.set({ outcome: 'no-session' });
    return empty(204, gone);
  }

  try {
    await revokeToken({
      accessToken: session.accessToken,
      config: setup.config,
    });
    log.set({ outcome: 'revoked' });
  } catch (error) {
    log.error(toLoggable(error), { step: 'revoke-token' });
    log.set({ outcome: 'revoke-failed' });
  }
  return empty(204, gone);
});

export const Route = createFileRoute('/api/auth/signout')({
  server: { handlers: { POST: signout } },
});
