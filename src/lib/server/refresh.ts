// What `/api/auth/refresh` decides, apart from the route that answers it: which
// grants are due, which forge spends each refresh token, and what the cookie
// says afterwards. The two token exchanges arrive as parameters, so the races
// the route exists to survive can be played out here in a test, one answer at
// a time.

import { type DeploymentConfig, gitLabHostFor } from './config';
import { REFRESH_ALREADY_SPENT, refreshGrant } from './github/app';
import {
  GITLAB_REFRESH_ALREADY_SPENT,
  refreshGitLabGrant,
} from './gitlab/oauth';
import { OAuthError } from './oauth';
import { type RequestLog, toLoggable } from '@/lib/logger';
import {
  accessTokenFresh,
  type GitHubGrant,
  type GitLabGrant,
  refreshable,
  type SessionPayload,
} from '@/lib/session';

/** The two token exchanges a refresh may spend. */
export interface Refreshers {
  github(refreshToken: string): Promise<GitHubGrant>;
  gitlab(host: string, refreshToken: string): Promise<GitLabGrant>;
}

/**
 * The forges' own exchanges, for this deployment. A GitHub refresh needs the
 * App; the route only asks for one when the App is configured.
 */
export function forgeRefreshers(
  config: DeploymentConfig,
  now: number
): Refreshers {
  return {
    async github(refreshToken) {
      const app = config.github.app;
      if (app == null) throw new Error('No GitHub App is configured.');
      return { ...(await refreshGrant({ config: app, now, refreshToken })) };
    },
    async gitlab(host, refreshToken) {
      const instance = gitLabHostFor(config, host);
      if (instance == null) throw new Error(`${host} is not configured.`);
      return refreshGitLabGrant({ host, instance, refreshToken, now });
    },
  };
}

/**
 * What the route answers: nothing to write (`keep`), the session ended
 * (`end`), or the cookie sealed again around `session`.
 */
export type RefreshResult =
  | { kind: 'keep' }
  | { kind: 'end' }
  | { kind: 'write'; session: SessionPayload };

/**
 * Spends the refresh tokens a session holds, and answers what the cookie should
 * say afterwards. `session` is one within the ceiling; the route has already
 * answered a missing or spent one.
 *
 * Once any grant is due, every grant that can be refreshed is — GitHub's
 * first, then each GitLab host in the cookie's order — not only the due ones.
 * Two tabs that read the clock a moment apart can disagree about which grants
 * are due, and two requests that rotated different grants would each write a
 * cookie with the other's spent one in it. Walking one fixed sequence means
 * both contest the same first grant: the loser loses it before rotating
 * anything and writes nothing, and the winner rotates and writes them all. The
 * cost is a grant rotated a little early, beside the one that was due.
 */
export async function refreshSession(input: {
  session: SessionPayload;
  config: DeploymentConfig;
  now: number;
  refreshers: Refreshers;
  log: RequestLog;
}): Promise<RefreshResult> {
  const { session, config, now, refreshers, log } = input;

  // Whether a refresh is needed at all. `accessTokenFresh` asks with the
  // skew; a grant five minutes from its expiry still counts as due.
  const githubDue =
    session.github != null && !accessTokenFresh(session.github, now);
  const gitlabGrants = Object.entries(session.gitlab ?? {});
  const gitlabDue = (grant: GitLabGrant) =>
    grant.type === 'oauth' && !accessTokenFresh(grant, now);

  if (!githubDue && !gitlabGrants.some(([, grant]) => gitlabDue(grant))) {
    log.set({ outcome: 'already-fresh' });
    return { kind: 'keep' };
  }

  let next: SessionPayload = { ...session };
  let refreshed = false;
  let dropped = false;

  const github = session.github;
  if (github != null) {
    const refreshToken = github.refreshToken;
    const canRefresh =
      config.github.app != null &&
      refreshToken != null &&
      refreshable(github, now);
    if (githubDue && !canRefresh) {
      log.set({ outcome: 'not-refreshable' });
      return { kind: 'end' };
    }
    if (canRefresh && refreshToken != null) {
      try {
        next = { ...next, github: await refreshers.github(refreshToken) };
        refreshed = true;
        log.set({ outcome: 'refreshed', forge: 'github' });
      } catch (error) {
        if (
          error instanceof OAuthError &&
          error.code === REFRESH_ALREADY_SPENT
        ) {
          log.set({ outcome: 'lost-race', forge: 'github' });
          return { kind: 'keep' };
        }
        log.error(toLoggable(error), {
          step: 'refresh-token',
          forge: 'github',
        });
        // A grant refreshed early that fails keeps working: the failed call
        // rotated nothing. Only a due one has nothing left to fall back on.
        if (githubDue) {
          log.set({ outcome: 'refresh-failed' });
          return { kind: 'end' };
        }
      }
    }
  }

  for (const [host, grant] of gitlabGrants) {
    if (grant.type !== 'oauth' || grant.refreshToken == null) continue;
    const due = gitlabDue(grant);
    if (gitLabHostFor(config, host) == null) {
      // The host is no longer configured, so the grant cannot be refreshed —
      // and once it is due, only it is dropped.
      if (due) {
        const { [host]: _dropped, ...rest } = next.gitlab ?? {};
        next = { ...next, gitlab: rest };
        dropped = true;
        log.set({ outcome: 'grant-dropped', forge: 'gitlab', host });
      }
      continue;
    }
    try {
      const fresh = await refreshers.gitlab(host, grant.refreshToken);
      next = { ...next, gitlab: { ...(next.gitlab ?? {}), [host]: fresh } };
      refreshed = true;
      log.set({ outcome: 'refreshed', forge: 'gitlab', host });
    } catch (error) {
      if (
        error instanceof OAuthError &&
        error.code === GITLAB_REFRESH_ALREADY_SPENT
      ) {
        // Another request holds the newer cookie, and it is the whole of it:
        // both walked this same sequence, so the grant lost here is the first
        // one both contested, and nothing was rotated before it.
        log.set({ outcome: 'lost-race', forge: 'gitlab', host });
        return { kind: 'keep' };
      }
      log.error(toLoggable(error), { step: 'refresh-token', forge: 'gitlab' });
      // A grant the instance will not refresh is dropped once it is due, and
      // only it; one refreshed early keeps working until then.
      if (due) {
        const { [host]: _dropped, ...rest } = next.gitlab ?? {};
        next = { ...next, gitlab: rest };
        dropped = true;
        log.set({ outcome: 'grant-dropped', forge: 'gitlab', host });
      }
    }
  }

  if (!refreshed && !dropped) {
    log.set({ outcome: 'nothing-refreshed' });
    return { kind: 'keep' };
  }

  // A drop alone is persisted too: an unwritten drop would leave the dead
  // grant in the cookie, due again on the next request. `issuedAt` is carried
  // forward, so a refresh does not extend the ceiling.
  log.set({ outcome: refreshed ? 'refreshed' : 'grant-dropped' });
  return { kind: 'write', session: { ...next, issuedAt: session.issuedAt } };
}
