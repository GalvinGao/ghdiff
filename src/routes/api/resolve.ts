import { createFileRoute } from '@tanstack/react-router';
import * as z from 'zod';

import { authExpiredMessage } from '@/lib/failure';
import { forgeGroupKey } from '@/lib/forges';
import { pathShapeOf } from '@/lib/reviewTarget';
import { gitLabHostsLabel } from '@/lib/server/config';
import { resolveCredentials } from '@/lib/server/credentials';
import { gitLabProjectVisible } from '@/lib/server/forges/gitlab';
import { sessionMiddleware } from '@/lib/server/middleware';
import { textResponse } from '@/lib/server/plainText';
import { validate } from '@/lib/server/validate';
import { m } from '@/paraglide/messages.js';

// Answers which configured GitLab host a bare `/-/` path lives on, as its
// canonical path in a 200's plain-text body. A redirect cannot carry that
// answer: the browser's fetch hands a manual redirect back as an
// opaque-redirect filtered response — no status, no headers to read — so the
// path travels as text the caller can always read. The splat route renders a
// resolve marker and the browser asks through `fetchWithRefresh`, so a spent
// grant is refreshed and the resolve retried inside the app. See
// `src/lib/resolveHost.ts`.
//
// A hostless GitLab splat — `group/sub/repo/-/merge_requests/1` — names a
// project and a page but not the instance, and one deployment may serve
// several. So each configured host is asked, in configured order and with the
// session's own grant for it when there is one, whether the project is
// visible there, and the first host that shows it wins. A miss everywhere is
// a 404 that names the hosts tried, because a private project is invisible
// to an anonymous probe and the fix is connecting an account that can see
// it. A grant that is spent with a live refresh behind it is no grant to
// probe with: the answer is the 401 every cookie-reading route keeps, and
// the browser mends the cookie and asks again.
//
// Nothing is cached: the probe costs one subrequest per configured host and
// only ever runs on a hostless address — the canonical form it answers with
// never asks again.

/**
 * The bare `/-/` path this route answers, as a zod schema. The shape is the
 * one `pathShapeOf` reads for every other consumer — a GitLab project path
 * of at least a group and a project, the `-` marker, then a page GitLab
 * knows — and the transform only reshapes: the project is the shape's, the
 * page keeps the marker.
 */
const splatPath = z.string().transform((path, ctx) => {
  const trimmed = path.replace(/^\//, '').replace(/\/+$/, '');
  const shape = pathShapeOf(trimmed);
  if (shape?.forge !== 'gitlab') {
    ctx.addIssue({ code: 'custom', message: 'not a GitLab path' });
    return z.NEVER;
  }
  // The page keeps the marker: it starts right after `project/`.
  return {
    project: shape.project,
    page: trimmed.slice(shape.project.length + 1),
  };
});

/** The route's query: the bare `/-/` path, split into project and page. */
const resolveQuery = z
  .object({ path: splatPath })
  .transform((input) => input.path);

export const Route = createFileRoute('/api/resolve')({
  server: {
    middleware: [
      validate({ search: resolveQuery }, () => ({
        outcome: 'invalid-path',
        message: m.resolve_that_address_is_not_a_gitlab_one_a_project(),
      })),
      sessionMiddleware,
    ],
    handlers: {
      GET: async ({
        request,
        context: { log, config, session, search: splat },
      }) => {
        if (config.gitlabHosts.length === 0) {
          log.set({ outcome: 'no-hosts' });
          return textResponse(
            m.resolve_this_ghdiff_serves_no_gitlab_hosts_so_that_address(),
            { status: 404, failure: { reason: 'not-served' } }
          );
        }

        const credentials = await resolveCredentials(config, session, request);
        // A cookie whose grant has died is answered before any host is asked:
        // the 401 is what sends the browser to refresh it, the same contract
        // `/api/diff` and its siblings keep. Which grant died is not knowable
        // here — GitHub's and GitLab's dues share one reading — so the typed
        // failure names no forge and the sentence names none either.
        if (credentials.refreshDue) {
          log.set({ outcome: 'refresh-due' });
          return textResponse(authExpiredMessage(), {
            status: 401,
            failure: { reason: 'auth-expired' },
          });
        }
        for (const { host } of config.gitlabHosts) {
          if (
            await gitLabProjectVisible(
              host,
              splat.project,
              credentials.byForge[forgeGroupKey({ forge: 'gitlab', host })] ??
                {}
            )
          ) {
            log.set({ outcome: 'resolved', host });
            // The canonical path as the body, not a Location header: a 200's
            // body is always readable, where a redirect's answer reaches the
            // browser's fetch filtered to nothing.
            return textResponse(`/${host}:${splat.project}/${splat.page}`);
          }
        }

        log.set({ outcome: 'not-visible' });
        return textResponse(
          m.resolve_no_gitlab_host_shows_that_project({
            hosts: gitLabHostsLabel(config),
          }),
          { status: 404, failure: { reason: 'not-found' } }
        );
      },
    },
  },
});
