import { createFileRoute } from '@tanstack/react-router';

import { type AuthFailure, authFailureUrl, callbackUrl } from '@/lib/githubApp';
import { requestLog, toLoggable, withEvlog } from '@/lib/logger';
import {
  notConfigured,
  readAuthSetup,
  redirectTo,
} from '@/lib/server/authRoute';
import { exchangeCode } from '@/lib/server/githubApp';
import { clearHandoff, readHandoff, writeSession } from '@/lib/server/session';

// Where GitHub sends the reviewer back. It spends the code and seals the session.
//
// The handoff cookie is spent whatever happens, on the first line of the answer:
// its `state` and its verifier are each good for exactly one callback, and a
// second attempt has to start from the beginning. Every path out of here
// therefore carries `clearHandoff()`.
//
// Four things are checked before GitHub is asked anything, and each has its own
// reason on the way out. The handoff must be there, which it is not if the
// reviewer sat on GitHub's page for ten minutes. GitHub must not have said the
// reviewer declined. There must be a code. And the `state` must be the one this
// app put aside — that comparison is the whole of the CSRF defence here, since a
// code arriving with somebody else's `state` is somebody else trying to hand
// this browser their session.

const callback = withEvlog(async ({ request }: { request: Request }) => {
  const log = requestLog();
  const setup = readAuthSetup();
  if (setup == null) {
    log.set({ outcome: 'not-configured' });
    return notConfigured();
  }

  const spent = clearHandoff();
  const handoff = await readHandoff(request, setup.keyring);
  const params = new URL(request.url).searchParams;

  function failed(reason: AuthFailure): Response {
    log.set({ outcome: 'failed', reason });
    return redirectTo(authFailureUrl(handoff?.returnTo ?? '/', reason), [
      spent,
    ]);
  }

  if (handoff == null) return failed('expired');
  // GitHub says so itself when the reviewer pressed Cancel, and that is not a
  // failure of this app to report as one.
  if (params.get('error') != null) return failed('denied');

  const code = params.get('code');
  const state = params.get('state');
  if (code == null || state == null) return failed('mismatch');
  if (state !== handoff.state) {
    log.set({ stateMatched: false });
    return failed('mismatch');
  }

  try {
    const now = Date.now();
    const grant = await exchangeCode({
      code,
      config: setup.config,
      now,
      redirectUri: callbackUrl(request.url),
      verifier: handoff.verifier,
    });
    log.set({
      outcome: 'signed-in',
      returnTo: handoff.returnTo,
      expiring: grant.accessExpiresAt != null,
    });
    return redirectTo(handoff.returnTo, [
      spent,
      // `issuedAt` is now and never again: a refresh carries this same moment
      // forward, so the ceiling is measured from this sign-in.
      await writeSession({ ...grant, issuedAt: now }, setup.keyring, now),
    ]);
  } catch (error) {
    // The code itself never reaches the log, here or anywhere: it is a
    // credential until it is spent, and a failed exchange is the one case where
    // it may not have been.
    log.error(toLoggable(error), { step: 'exchange-code' });
    return failed('github');
  }
});

export const Route = createFileRoute('/api/auth/callback')({
  server: { handlers: { GET: callback } },
});
