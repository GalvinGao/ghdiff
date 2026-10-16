import { createFileRoute } from '@tanstack/react-router';

import { authExpiredMessage, failureForStatus } from '@/lib/failure';
import { repoRefFromTarget } from '@/lib/forges';
import { toLoggable } from '@/lib/logger';
import {
  hostedTargetSearch,
  LOCAL_TARGET_NOT_SERVED,
  reviewTargetKey,
} from '@/lib/reviewTarget';
import { resolveForgeCredential } from '@/lib/server/credentials';
import { forgeFor } from '@/lib/server/forges';
import { GitHubError } from '@/lib/server/github/client';
import { sessionMiddleware } from '@/lib/server/middleware';
import { textResponse } from '@/lib/server/plainText';
import { recordServe } from '@/lib/server/served';
import { validate } from '@/lib/server/validate';
import { m } from '@/paraglide/messages.js';

// Returns the unified diff for one review target as text/plain.
//
// The target names its forge, and the forge answers — GitHub through its
// three-source cascade. This route is deliberately
// not an RPC procedure: a patch runs to tens of megabytes, and the forge's
// stream goes straight to the browser without a JSON envelope in between.
//
// A browser that kept the patch from last time sends its ETag back as
// `If-None-Match`, and the forge passes it on to whichever source compares
// it: a 304 comes back as a 304 with no body, so nothing is read or sent twice.

export const Route = createFileRoute('/api/diff')({
  server: {
    middleware: [
      validate({ search: hostedTargetSearch }, () => ({
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
        // The one target this host cannot answer for, and the one it must not
        // try to: workerd spawns no process and reads no path on anybody's
        // disk. It reaches here only from a link pasted out of a local run.
        if (target.kind === 'local-diff') {
          log.set({ outcome: 'local-target' });
          return textResponse(LOCAL_TARGET_NOT_SERVED(), { status: 400 });
        }
        log.set({ target: reviewTargetKey(target), targetKind: target.kind });
        const ref = repoRefFromTarget(target);

        // A cookie whose token has died is answered before the forge is asked:
        // the 401 is what sends the browser to refresh it, and the same
        // request arrives again with a live one. Not a serve, since no source
        // answered. The typed `auth-expired` rides the header for the answer
        // the refresh could not mend.
        const { cred, refreshDue } = await resolveForgeCredential(
          config,
          session,
          request
        );
        if (refreshDue) {
          log.set({ outcome: 'refresh-due' });
          return textResponse(authExpiredMessage(ref.forge), {
            status: 401,
            failure: { reason: 'auth-expired', forge: ref.forge },
          });
        }

        try {
          const forge = forgeFor(config, ref);
          const response = await forge.diff(
            target,
            cred,
            log,
            request.headers.get('if-none-match') ?? undefined
          );
          // One serve, counted. `diff` returns only when a source answered, so
          // a 404 or a spent quota is not a serve. The write itself happens
          // after this response has gone.
          recordServe();
          return response;
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
          log.error(toLoggable(error), { step: 'load-diff' });
          return textResponse(m.diff_could_not_load_that_diff(), {
            status: 500,
          });
        }
      },
    },
  },
});
