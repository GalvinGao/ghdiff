import { createFileRoute } from '@tanstack/react-router';
import * as z from 'zod';

import { FILE_TOO_LARGE, MAX_FILE_BYTES } from '@/lib/diffHydration';
import { authExpiredMessage, failureForStatus } from '@/lib/failure';
import { isReadablePath } from '@/lib/filePath';
import { gitLabHostOf, repoRefFromTarget } from '@/lib/forges';
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
import { conditionalResponse, textResponse } from '@/lib/server/plainText';
import { validate } from '@/lib/server/validate';
import { m } from '@/paraglide/messages.js';

// One file's contents, as text/plain, at the commit the target's diff ends on.
//
// This is what lets a reviewer expand the unmodified lines around a hunk: a
// patch carries three lines of context and the viewer needs the whole file.
// It is a route and not an RPC procedure for the same reason `/api/diff` is
// one — the body is a file, the forge hands its own stream straight to the
// browser, and a JSON envelope would make it read all of it into memory and
// escape it first.
//
// Only the new side is fetched. `src/lib/diffHydration.ts` rebuilds the old
// side from this file and the patch, which costs no request and cannot
// disagree with the diff on screen.
//
// Both of the forge's sources answer `If-None-Match`, so a browser that kept
// the file from last time sends its ETag back and gets a 304 with no body when
// the file has not moved.

/**
 * A path arrives from a browser and goes into the URL of whichever source
 * answers. The forge escapes each segment but leaves a dot alone, so a `.` or
 * `..` segment would climb out of the endpoint: the segments are checked here,
 * by the rule the `ghdiff` command applies too, rather than trusted there.
 */
const filePath = z.string().refine(isReadablePath);

/**
 * The route's query: the target, and the path within it, as one flat object
 * — the intersection's output is the target with a `path` beside it.
 */
const fileQuery = hostedTargetSearch.and(z.object({ path: filePath }));

/**
 * How many bytes the forge says the file is, or nothing when it did not say
 * anything this route can act on. `content-length` counts the bytes on the
 * wire, so a compressed answer states a figure far under the file's own size
 * and is no answer at all; a chunked one states nothing. Either way the
 * browser counts what it decodes, and that is the guard that always holds.
 */
function statedSize(response: Response): number | undefined {
  if (response.headers.get('content-encoding') != null) return undefined;
  const header = response.headers.get('content-length');
  if (header == null) return undefined;
  const size = Number(header);
  return Number.isFinite(size) ? size : undefined;
}

export const Route = createFileRoute('/api/file')({
  server: {
    middleware: [
      validate({ search: fileQuery }, (error) => {
        // A failure on the path alone is the path's answer; anything else is
        // the target's — the order the old two-step check answered in. The
        // channel wraps the schema, so the field is the path's second leg.
        const pathOnly =
          error != null &&
          error.issues.every((issue) => issue.path[1] === 'path');
        return pathOnly
          ? {
              outcome: 'invalid-path',
              message: m.file_that_file_path_is_not_valid(),
            }
          : {
              outcome: 'invalid-target',
              message: m.file_that_review_target_is_not_valid(),
            };
      }),
      sessionMiddleware,
    ],
    handlers: {
      GET: async ({ request, context: { log, config, session, search } }) => {
        // See the same guard in `/api/diff`: a local diff is the command's own
        // to serve, and this host has no disk to read it from.
        if (search.kind === 'local-diff') {
          log.set({ outcome: 'local-target' });
          return textResponse(LOCAL_TARGET_NOT_SERVED(), { status: 400 });
        }
        log.set({
          target: reviewTargetKey(search),
          targetKind: search.kind,
          path: search.path,
        });
        const ref = repoRefFromTarget(search);
        const host = gitLabHostOf(ref);

        const { cred, refreshDue } = await resolveForgeCredential(
          config,
          session,
          request,
          search
        );
        // A cookie whose token has died is answered before the forge is asked:
        // the 401 is what sends the browser to refresh it, and the same
        // request arrives again with a live one. The typed `auth-expired`
        // rides the header for the answer the refresh could not mend.
        if (refreshDue) {
          log.set({ outcome: 'refresh-due' });
          return textResponse(authExpiredMessage(ref.forge, host), {
            status: 401,
            failure: { reason: 'auth-expired', forge: ref.forge, host },
          });
        }
        log.set({ authenticated: cred.token != null });
        try {
          const forge = forgeFor(config, ref);
          const response = await forge.file(
            search,
            search.path,
            cred,
            request.headers.get('if-none-match') ?? undefined
          );
          if (response.status === 304) {
            log.set({ outcome: 'unchanged' });
            return conditionalResponse(response);
          }
          const size = statedSize(response);
          if (size != null && size > MAX_FILE_BYTES) {
            // Nothing here reads the body, so it is cancelled rather than left
            // for the runtime to hold open behind a response nobody wanted.
            void response.body?.cancel();
            log.set({ outcome: 'too-large', size });
            return textResponse(FILE_TOO_LARGE(), { status: 413 });
          }
          log.set({ outcome: 'ok', size });
          return conditionalResponse(response);
        } catch (error) {
          if (error instanceof GitHubError) {
            log.set({ outcome: 'error', status: error.status });
            return textResponse(error.message, {
              status: error.status,
              failure:
                error.failure ??
                failureForStatus(error.status, {
                  forge: ref.forge,
                  host,
                  credentialed: cred.token != null,
                }),
            });
          }
          log.error(toLoggable(error), { step: 'load-file' });
          return textResponse(m.file_could_not_load_that_file(), {
            status: 500,
          });
        }
      },
    },
  },
});
