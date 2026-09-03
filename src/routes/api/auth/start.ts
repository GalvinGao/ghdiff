import { createFileRoute } from '@tanstack/react-router';

import { authorizeUrl, callbackUrl } from '@/lib/githubApp';
import { requestLog, withEvlog } from '@/lib/logger';
import {
  notConfigured,
  readAuthSetup,
  redirectTo,
} from '@/lib/server/authRoute';
import { codeChallenge, randomToken, writeHandoff } from '@/lib/server/session';
import { safeReturnTo } from '@/lib/session';

// Where a sign-in begins. It puts three things aside and sends the reviewer to
// GitHub.
//
// A GET and not a POST, because this has to be a top-level navigation: the whole
// point is to leave this site. It changes nothing that matters — a `state` and a
// verifier nobody has used yet — so there is nothing here for a cross-site link
// to do except start a sign-in the reviewer then has to agree to at GitHub.
//
// `returnTo` arrives from the browser rather than being read off a header,
// because the fragment is the part worth keeping and the fragment is the one
// part of an address a browser never sends. `safeReturnTo` is what makes that
// safe: the value is written into a `Location` later, and everything that is not
// a path on this site resolves to the home page.

const start = withEvlog(async ({ request }: { request: Request }) => {
  const log = requestLog();
  const setup = readAuthSetup();
  if (setup == null) {
    log.set({ outcome: 'not-configured' });
    return notConfigured();
  }

  const returnTo = safeReturnTo(
    new URL(request.url).searchParams.get('returnTo')
  );
  const state = randomToken();
  const verifier = randomToken();

  log.set({ outcome: 'redirect', returnTo });
  return redirectTo(
    authorizeUrl({
      challenge: await codeChallenge(verifier),
      clientId: setup.config.clientId,
      redirectUri: callbackUrl(request.url),
      state,
    }),
    [await writeHandoff({ state, verifier, returnTo }, setup.keyring)]
  );
});

export const Route = createFileRoute('/api/auth/start')({
  server: { handlers: { GET: start } },
});
