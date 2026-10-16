// Every credential a request speaks with.
//
// GitHub's is `resolveGitHubToken`'s cascade: a Bearer header the caller named,
// then the sealed session cookie, then `GITHUB_TOKEN`. A spent credential with
// a live refresh behind it is not a credential at all but the 401 that sends
// the browser to mend it.

import type { DeploymentConfig } from './config';
import type { ForgeCredential } from './forges/types';
import { resolveGitHubToken } from './github/client';
import type { SessionPayload } from '@/lib/session';

/**
 * Every credential a request resolved, for every forge group. `byForge` holds
 * the usable credential of each group, keyed by `forgeGroupKey` — `github`,
 * from `resolveGitHubToken`'s cascade. `refreshDue` is true when a grant is
 * spent with a live refresh behind it: the 401 it produces sends the browser
 * to the refresh route, which mends it.
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
  const { token, fromSession, refreshDue } = await resolveGitHubToken(
    config,
    session,
    request
  );
  const fromHeader = /^Bearer\s+/i.test(
    request.headers.get('authorization') ?? ''
  );

  return {
    byForge: { github: { token, fromSession } },
    ...(fromHeader ? { headerToken: token } : {}),
    refreshDue,
  };
}

/**
 * The credential one route's target speaks with: `resolveGitHubToken`'s
 * answer, header first, because a caller that named a credential meant that
 * one.
 */
export async function resolveForgeCredential(
  config: DeploymentConfig,
  session: SessionPayload | undefined,
  request: Request
): Promise<{ cred: ForgeCredential; refreshDue: boolean }> {
  const { token, fromSession, refreshDue } = await resolveGitHubToken(
    config,
    session,
    request
  );
  return { cred: { token, fromSession }, refreshDue };
}
