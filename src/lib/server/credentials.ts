// Every credential a request speaks with, on either forge.
//
// The GitHub half is `resolveGitHubToken`'s cascade: a Bearer header the
// caller named, then the sealed session cookie, then `GITHUB_TOKEN`. The
// GitLab half is the session's usable grants keyed by host — a PAT travels as
// `private-token`, an OAuth grant as a bearer — for the hosts this deployment
// serves. A grant for any other host is inert: it answers no request, and its
// staleness must not send the browser on a refresh that has nothing to mend.
// On either forge, a spent credential with a live refresh behind it is not a
// credential at all but the 401 that sends the browser to mend it.

import { gitLabHostFor, type DeploymentConfig } from './config';
import type { ForgeCredential } from './forges/types';
import { resolveGitHubToken } from './github/client';
import { forgeGroupKey, isGitLabTarget } from '@/lib/forges';
import type { ReviewTarget } from '@/lib/reviewTarget';
import {
  accessTokenUsable,
  refreshable,
  type SessionPayload,
  withinMaxAge,
} from '@/lib/session';

/**
 * Every credential a request resolved, for every forge group. `byForge` holds
 * the usable credential of each group, keyed by `forgeGroupKey` — `github`,
 * or `gitlab:<host>` — GitHub's from `resolveGitHubToken`'s cascade, a GitLab
 * host's from the session's usable grants. `refreshDue` is true when ANY
 * grant — GitHub's or a GitLab OAuth one — is spent with a live refresh
 * behind it: the 401 it produces sends the browser to the refresh route,
 * which mends all of them.
 */
export interface ResolvedCredentials {
  /** The usable credential of each forge group, keyed by `forgeGroupKey`. */
  byForge: Record<string, ForgeCredential>;
  /** A Bearer credential named on the request's own Authorization header. */
  headerToken?: string;
  refreshDue: boolean;
}

export async function resolveCredentials(
  config: DeploymentConfig,
  session: SessionPayload | undefined,
  request: Request
): Promise<ResolvedCredentials> {
  const {
    token,
    fromSession,
    refreshDue: githubDue,
  } = await resolveGitHubToken(config, session, request);
  const fromHeader = /^Bearer\s+/i.test(
    request.headers.get('authorization') ?? ''
  );

  const byForge: Record<string, ForgeCredential> = {
    github: { token, fromSession },
  };
  let gitlabDue = false;
  if (session != null && config.gitlabHosts.length > 0) {
    const now = Date.now();
    if (withinMaxAge(session, now)) {
      for (const [host, grant] of Object.entries(session.gitlab ?? {})) {
        if (gitLabHostFor(config, host) == null) continue;
        if (grant.type === 'pat') {
          byForge[forgeGroupKey({ forge: 'gitlab', host })] = {
            token: grant.token,
            scheme: 'private-token',
            fromSession: true,
          };
        } else if (accessTokenUsable(grant, now)) {
          byForge[forgeGroupKey({ forge: 'gitlab', host })] = {
            token: grant.accessToken,
            scheme: 'bearer',
            fromSession: true,
          };
        } else if (refreshable(grant, now)) {
          // A PAT never refreshes; an OAuth grant with a live refresh token
          // is a grant this browser can mend, so it is answered 401 like the
          // GitHub one rather than dropped to anonymous.
          gitlabDue = true;
        }
      }
    }
  }

  return {
    byForge,
    ...(fromHeader ? { headerToken: token } : {}),
    refreshDue: githubDue || gitlabDue,
  };
}

/**
 * The credential one route's target speaks with. The header wins on either
 * forge, because a caller that named a credential meant that one. Behind it,
 * the GitHub resolution is `resolveGitHubToken`'s and the GitLab one is the
 * session's grant for the target's host — PATs and usable OAuth grants, or
 * `refreshDue` when a GitLab OAuth grant is spent with a live refresh behind
 * it.
 */
export async function resolveForgeCredential(
  config: DeploymentConfig,
  session: SessionPayload | undefined,
  request: Request,
  target: ReviewTarget
): Promise<{ cred: ForgeCredential; refreshDue: boolean }> {
  if (isGitLabTarget(target)) {
    const resolved = await resolveCredentials(config, session, request);
    if (resolved.headerToken != null) {
      return {
        cred: { token: resolved.headerToken, scheme: 'bearer' },
        refreshDue: false,
      };
    }
    return {
      cred:
        resolved.byForge[
          forgeGroupKey({ forge: 'gitlab', host: target.host })
        ] ?? {},
      refreshDue: resolved.refreshDue,
    };
  }
  const {
    token,
    fromSession,
    refreshDue: due,
  } = await resolveGitHubToken(config, session, request);
  return { cred: { token, fromSession }, refreshDue: due };
}
