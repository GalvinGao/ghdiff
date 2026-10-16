import { createFileRoute } from '@tanstack/react-router';

import { authExpiredMessage, failureForStatus } from '@/lib/failure';
import { repoRefFromTarget } from '@/lib/forges';
import { toLoggable } from '@/lib/logger';
import { reviewTargetKey, reviewTargetSearch } from '@/lib/reviewTarget';
import { resolveForgeCredential } from '@/lib/server/credentials';
import { forgeFor } from '@/lib/server/forges';
import { GitHubError } from '@/lib/server/github/client';
import { sessionMiddleware } from '@/lib/server/middleware';
import { textResponse } from '@/lib/server/plainText';
import { validate } from '@/lib/server/validate';
import { m } from '@/paraglide/messages.js';

// One image the forge hosts, streamed back with the caller's credential.
//
// A comment body's `<img>` cannot load from a private repository: the
// attachment address demands github.com's own session cookie, which the
// browser does not have on this origin — the reviewer's credential is a
// sealed grant only this server reads. So `CommentBody` points those images
// here and the forge fetches with the reviewer's credential. It is a route
// and not a procedure for the same reason `/api/file` is one: the body is a
// stream and an RPC envelope would buffer and escape it first.
//
// The proxy reaches only the image hosts the forge allows — GitHub's are
// `isGitHubMediaUrl`'s list — so this is not a way to make the server fetch
// anywhere. There is no byte cap: the address space is that list and the
// content-type gate holds it to images, and the body is piped, never
// buffered.
//
// A dead token answers 401 like `/api/file`, but an `<img>` load cannot run
// `withRefresh`: the picture stays broken until any real request refreshes
// the session and the browser asks again. Accepted — every app request does.

export const Route = createFileRoute('/api/media')({
  server: {
    middleware: [
      validate({ search: reviewTargetSearch }, () => ({
        outcome: 'invalid-target',
        message: m.diff_that_review_target_is_not_valid(),
      })),
      sessionMiddleware,
    ],
    handlers: {
      GET: async ({
        request,
        context: { log, config, session, search: target },
      }) => {
        const ref = repoRefFromTarget(target);
        const url = new URL(request.url).searchParams.get('url');
        if (url == null || url.length === 0 || url.length > 2048) {
          log.set({ outcome: 'invalid-url' });
          return textResponse(m.forge_that_image_address_is_not_valid(), {
            status: 400,
            failure: { reason: 'bad-request', forge: ref.forge },
          });
        }
        log.set({ target: reviewTargetKey(target), targetKind: target.kind });

        const { cred, refreshDue } = await resolveForgeCredential(
          config,
          session,
          request
        );
        // A cookie whose token has died is answered before the forge is asked:
        // the 401 is the same contract `/api/file` keeps.
        if (refreshDue) {
          log.set({ outcome: 'refresh-due' });
          return textResponse(authExpiredMessage(ref.forge), {
            status: 401,
            failure: { reason: 'auth-expired', forge: ref.forge },
          });
        }
        log.set({ authenticated: cred.token != null });
        try {
          const forge = forgeFor(config, ref);
          if (forge.media == null) {
            log.set({ outcome: 'unsupported' });
            return textResponse(m.media_this_forge_hosts_no_images_to_proxy(), {
              status: 404,
            });
          }
          const response = await forge.media(target, url, cred);
          log.set({ outcome: 'ok' });
          // Never cached: the answer depends on whose credential fetched it,
          // and a browser cache keyed by URL alone would hand one account's
          // private image to the next one signed in here. The CSP is the SVG
          // case: a scripted one navigated to directly must not
          // run in this origin, and `sandbox` makes it an opaque one, its
          // links and forms dead.
          return new Response(response.body, {
            status: 200,
            headers: {
              'cache-control': 'no-store',
              'content-security-policy': "default-src 'none'; sandbox",
              'content-type':
                response.headers.get('content-type') ??
                'application/octet-stream',
              'x-content-type-options': 'nosniff',
            },
          });
        } catch (error) {
          if (error instanceof GitHubError) {
            log.set({ outcome: 'error', status: error.status });
            return textResponse(error.message, {
              status: error.status,
              failure:
                error.failure ??
                failureForStatus(error.status, {
                  forge: ref.forge,
                  credentialed: cred.token != null,
                }),
            });
          }
          log.error(toLoggable(error), { step: 'load-media' });
          return textResponse(m.media_could_not_load_that_image(), {
            status: 500,
          });
        }
      },
    },
  },
});
