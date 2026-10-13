import { createFileRoute } from '@tanstack/react-router';
import * as z from 'zod';

import { toLoggable } from '@/lib/logger';
import { HOST_PATTERN } from '@/lib/reviewTarget';
import { empty, notThisGitLab } from '@/lib/server/authRoute';
import { gitLabHostFor, gitLabHostsLabel } from '@/lib/server/config';
import { gitLabForge } from '@/lib/server/forges/gitlab';
import { GitHubError } from '@/lib/server/github/client';
import { originMiddleware, sessionMiddleware } from '@/lib/server/middleware';
import { textResponse } from '@/lib/server/plainText';
import { validate } from '@/lib/server/validate';
import { withGitLabGrant } from '@/lib/session';
import { m } from '@/paraglide/messages.js';

// Where a personal access token becomes a GitLab connection.
//
// OAuth needs an application registered on the instance, and a self-hosted
// GitLab ghdiff has never met has none. A PAT is the universal fallback: the
// reviewer creates one on the instance, pastes it here, and this route checks
// it against the instance before sealing it into the same httpOnly session
// cookie the OAuth grants live in. It never touches browser storage — that is
// the bar this app set when the old token form was removed.

const input = z.object({
  host: z.string().regex(HOST_PATTERN, {
    error: () => m.contract_enter_a_valid_gitlab_hostname(),
  }),
  token: z.string().min(1, { error: () => m.pat_paste_the_token_first() }),
});

export const Route = createFileRoute('/api/auth/gitlab/pat')({
  server: {
    middleware: [
      originMiddleware,
      validate({ body: input }, (error) => ({
        outcome: 'invalid-input',
        message:
          error?.issues[0]?.message ?? m.pat_that_is_not_a_host_and_a_token(),
      })),
      sessionMiddleware,
    ],
    handlers: {
      POST: async ({
        context: { log, config, keyring, seal, session, body: fields },
      }) => {
        if (keyring == null) {
          log.set({ outcome: 'not-configured' });
          return empty(501);
        }
        const host = fields.host.toLowerCase();

        // A deployment with no GitLab hosts has none to connect, and a token
        // for a host it does not serve is sealed nowhere.
        if (config.gitlabHosts.length === 0) {
          log.set({ outcome: 'wrong-forge', host });
          return notThisGitLab(config);
        }
        if (gitLabHostFor(config, host) == null) {
          log.set({ outcome: 'wrong-host', host });
          return textResponse(
            m.pat_this_ghdiff_serves_gitlab_on({
              hosts: gitLabHostsLabel(config),
            }),
            { status: 400 }
          );
        }

        // The token proves itself before it is sealed: the instance is asked
        // who it belongs to, and a token it does not know is answered with the
        // instance's own sentence rather than sealed and found out later.
        try {
          const viewer = await gitLabForge.viewer(
            { token: fields.token, scheme: 'private-token' },
            host
          );
          if (viewer == null) {
            log.set({ outcome: 'refused', host });
            return textResponse(m.pat_gitlab_did_not_accept_that_token(), {
              status: 401,
            });
          }

          const now = Date.now();
          const existing = session;
          log.set({ outcome: 'connected', host, viewer: viewer.login });
          return empty(204, [
            await seal.writeSession(
              withGitLabGrant(
                existing,
                host,
                { type: 'pat', token: fields.token },
                now
              ),
              now
            ),
          ]);
        } catch (error) {
          log.error(toLoggable(error), { step: 'validate-pat', host });
          if (error instanceof GitHubError) {
            return textResponse(error.message, { status: error.status });
          }
          return textResponse(m.pat_could_not_reach_that_gitlab_instance(), {
            status: 502,
          });
        }
      },
    },
  },
});
