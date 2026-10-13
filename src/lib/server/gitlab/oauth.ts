// The calls a GitLab OAuth application makes about its own credentials: spend
// a code, spend a refresh token, and revoke an access token. The mirror of
// `server/github/app.ts` for the second forge, against the instance's own
// `/oauth/*` endpoints — which is why every call takes the host.

import type { GitLabHostConfig } from '@/lib/server/config';
import { USER_AGENT } from '@/lib/server/github/client';
import {
  OAuthError,
  type OAuthTokenResponse,
  spendOAuthGrant,
} from '@/lib/server/oauth';
import type { GitLabGrant } from '@/lib/session';
import { m } from '@/paraglide/messages.js';

/**
 * GitLab's own name for what went wrong. The one worth naming is the answer to
 * a refresh token that has already been spent — `invalid_grant` — which is
 * what a second tab gets when the first one refreshed a moment earlier.
 */
export const GITLAB_REFRESH_ALREADY_SPENT = 'invalid_grant';

/** A code from the callback, for an OAuth grant on one instance. */
export function exchangeGitLabCode(input: {
  host: string;
  instance: GitLabHostConfig;
  code: string;
  redirectUri: string;
  verifier: string;
  now: number;
}): Promise<GitLabGrant> {
  return spendGrant(input.host, input.instance, input.now, {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
  });
}

/**
 * A refresh token, for the next two hours. GitLab rotates the pair on every
 * spend, which is why only the refresh route ever calls this.
 */
export function refreshGitLabGrant(input: {
  host: string;
  instance: GitLabHostConfig;
  refreshToken: string;
  now: number;
}): Promise<GitLabGrant> {
  return spendGrant(input.host, input.instance, input.now, {
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  });
}

/**
 * Ends an access token at the instance. GitLab's revoke endpoint is idempotent
 * by spec — it answers 200 whether the token was live or not — so a failure
 * here is a transport failure and nothing else is worth failing a sign-out
 * over.
 */
export async function revokeGitLabToken(input: {
  host: string;
  instance: GitLabHostConfig;
  accessToken: string;
}): Promise<void> {
  const { clientId, clientSecret } = input.instance;
  if (clientId == null || clientSecret == null) return;
  const response = await fetch(`https://${input.host}/oauth/revoke`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': USER_AGENT,
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      token: input.accessToken,
    }),
  });
  if (!response.ok) {
    throw new OAuthError(
      `http_${response.status}`,
      m.gitlab_oauth_gitlab_would_not_revoke_that_token()
    );
  }
}

async function spendGrant(
  host: string,
  instance: GitLabHostConfig,
  now: number,
  fields: Record<string, string>
): Promise<GitLabGrant> {
  const { clientId, clientSecret } = instance;
  if (clientId == null || clientSecret == null) {
    throw new OAuthError(
      'not_configured',
      m.gitlab_oauth_no_oauth_application_for_host({ host })
    );
  }

  const grant = await spendOAuthGrant({
    url: `https://${host}/oauth/token`,
    clientId,
    clientSecret,
    fields,
    now,
    forge: 'GitLab',
    readAnswer: async (response) => {
      if (!response.ok) {
        // Doorkeeper answers a token failure with a 4xx and the RFC 6749 JSON
        // error body — not GitHub's 200-with-an-error-field — so the code is
        // read out of the body when there is one. This is what makes
        // `invalid_grant` reachable, and the refresh route's lost-race answer
        // depends on it.
        const refused = (await response.json().catch(() => undefined)) as
          | OAuthTokenResponse
          | undefined;
        if (refused?.error != null) {
          throw new OAuthError(
            refused.error,
            refused.error_description ??
              m.gitlab_oauth_gitlab_refused_that({ error: refused.error })
          );
        }
        throw new OAuthError(
          `http_${response.status}`,
          m.gitlab_oauth_gitlab_answered_for_that_token_request({
            status: response.status,
          })
        );
      }
      return (await response.json()) as OAuthTokenResponse;
    },
  });

  return {
    type: 'oauth',
    accessToken: grant.accessToken,
    accessExpiresAt: grant.accessExpiresAt,
    refreshToken: grant.refreshToken,
  };
}
