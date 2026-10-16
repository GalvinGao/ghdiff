import { createFileRoute } from '@tanstack/react-router';

import { authorizeUrl, callbackUrl } from '@/lib/github/app';
import { gitLabAuthorizeUrl } from '@/lib/gitlab/urls';
import {
  noGitLabOAuth,
  notConfigured,
  notThisGitLab,
  redirectTo,
} from '@/lib/server/authRoute';
import { gitLabHostFor } from '@/lib/server/config';
import { sessionMiddleware } from '@/lib/server/middleware';
import { externalRequestUrl } from '@/lib/server/origin';
import { codeChallenge, randomToken } from '@/lib/server/session';
import { safeReturnTo } from '@/lib/session';

// Where a sign-in begins. It puts three things aside and sends the reviewer to
// the forge.
//
// A GET and not a POST, because this has to be a top-level navigation: the whole
// point is to leave this site. It changes nothing that matters — a `state` and a
// verifier nobody has used yet — so there is nothing here for a cross-site link
// to do except start a sign-in the reviewer then has to agree to at the forge.
//
// `returnTo` arrives from the browser rather than being read off a header,
// because the fragment is the part worth keeping and the fragment is the one
// part of an address a browser never sends. `safeReturnTo` is what makes that
// safe: the value is written into a `Location` later, and everything that is not
// a path on this site resolves to the home page.

export const Route = createFileRoute('/api/auth/start')({
  server: {
    middleware: [sessionMiddleware],
    handlers: {
      GET: async ({ request, context: { log, config, keyring, seal } }) => {
        const params = new URL(request.url).searchParams;
        const returnTo = safeReturnTo(params.get('returnTo'));

        if (params.get('forge') === 'gitlab') {
          // A deployment with no GitLab hosts has no GitLab flow to start —
          // the same gate the PAT route keeps.
          if (config.gitlabHosts.length === 0) {
            log.set({ outcome: 'wrong-forge' });
            return notThisGitLab(config);
          }

          const host = params.get('host')?.toLowerCase();
          const instance =
            host == null ? undefined : gitLabHostFor(config, host);
          // OAuth needs the keyring to seal with and the instance's own
          // application to send the reviewer to. A host without one is a PAT
          // host, and that flow starts in the dialog instead.
          if (
            host == null ||
            keyring == null ||
            instance == null ||
            instance.clientId == null ||
            instance.clientSecret == null
          ) {
            log.set({ outcome: 'not-configured', forge: 'gitlab', host });
            return noGitLabOAuth(config, host);
          }

          const state = randomToken();
          const verifier = randomToken();
          log.set({ outcome: 'redirect', forge: 'gitlab', host, returnTo });
          return redirectTo(
            gitLabAuthorizeUrl({
              challenge: await codeChallenge(verifier),
              clientId: instance.clientId,
              host,
              redirectUri: callbackUrl(externalRequestUrl(request)),
              state,
            }),
            [
              await seal.writeHandoff({
                state,
                verifier,
                returnTo,
                forge: 'gitlab',
                host,
              }),
            ]
          );
        }

        const app = config.github.app;
        if (app == null || keyring == null) {
          log.set({ outcome: 'not-configured' });
          return notConfigured();
        }

        const state = randomToken();
        const verifier = randomToken();

        log.set({ outcome: 'redirect', returnTo });
        return redirectTo(
          authorizeUrl({
            challenge: await codeChallenge(verifier),
            clientId: app.clientId,
            redirectUri: callbackUrl(externalRequestUrl(request)),
            state,
          }),
          [
            await seal.writeHandoff({
              state,
              verifier,
              returnTo,
            }),
          ]
        );
      },
    },
  },
});
