import { createFileRoute } from '@tanstack/react-router';

import { toLoggable } from '@/lib/logger';
import { empty } from '@/lib/server/authRoute';
import { revokeToken } from '@/lib/server/github/app';
import { originMiddleware, sessionMiddleware } from '@/lib/server/middleware';

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

export const Route = createFileRoute('/api/auth/signout')({
  server: {
    middleware: [originMiddleware, sessionMiddleware],
    handlers: {
      POST: async ({ context: { log, config, keyring, seal, session } }) => {
        const gone = [seal.clearSession(), seal.clearHandoff()];
        if (keyring == null) {
          log.set({ outcome: 'not-configured' });
          return empty(204, gone);
        }

        const app = config.github.app;
        if (app == null || session?.github == null) {
          log.set({ outcome: 'no-session' });
          return empty(204, gone);
        }

        try {
          await revokeToken({
            accessToken: session.github.accessToken,
            config: app,
          });
          log.set({ outcome: 'revoked' });
        } catch (error) {
          log.error(toLoggable(error), { step: 'revoke-token' });
          log.set({ outcome: 'revoke-failed' });
        }
        return empty(204, gone);
      },
    },
  },
});
