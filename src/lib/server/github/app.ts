// The three calls the App makes about its own credentials: spend a code, spend a
// refresh token, and revoke an access token. Nothing else here talks to GitHub.
//
// The token endpoint is not on `api.github.com` and does not behave like it. It
// answers 200 with an `error` field for a code that has been spent, a verifier
// that does not match, and a refresh token somebody already used — so the status
// alone says nothing, and `OAuthError` carries GitHub's own error code up to
// the route. `/api/auth/refresh` reads that code: one value of it means another
// tab won a race, and every other value means the session is over.

import { USER_AGENT } from './client';
import { TOKEN_URL } from '@/lib/github/app';
import type { GitHubAppConfig } from '@/lib/server/config';
import {
  OAuthError,
  type OAuthTokenGrant,
  type OAuthTokenResponse,
  spendOAuthGrant,
} from '@/lib/server/oauth';
import { m } from '@/paraglide/messages.js';

/**
 * GitHub's own name for what went wrong. The one worth naming is the answer to
 * a refresh token that has already been spent: it is what a second tab gets when
 * the first one refreshed a moment earlier, and it is not a reason to sign
 * anybody out.
 */
export const REFRESH_ALREADY_SPENT = 'bad_refresh_token';

/** A code from the callback, for a session. */
export function exchangeCode(input: {
  code: string;
  config: GitHubAppConfig;
  now: number;
  redirectUri: string;
  verifier: string;
}): Promise<OAuthTokenGrant> {
  return spendGrant(input.config, input.now, {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
  });
}

/**
 * A refresh token, for the next eight hours. GitHub invalidates the token it was
 * given and answers with a new pair, which is why only one route in this app
 * ever calls this.
 */
export function refreshGrant(input: {
  config: GitHubAppConfig;
  now: number;
  refreshToken: string;
}): Promise<OAuthTokenGrant> {
  return spendGrant(input.config, input.now, {
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  });
}

/**
 * Ends an access token at GitHub. This is what makes a sign-out a sign-out: the
 * cookie goes either way, and without this the token behind it would stay good
 * for the rest of its eight hours wherever a copy of that cookie had got to.
 *
 * It authenticates as the App itself, with the client id and secret as HTTP
 * Basic, because the question is about the App's own grant rather than about
 * anything the user can speak for.
 */
export async function revokeToken(input: {
  accessToken: string;
  config: GitHubAppConfig;
}): Promise<void> {
  const { clientId, clientSecret } = input.config;
  const response = await fetch(
    `https://api.github.com/applications/${encodeURIComponent(clientId)}/token`,
    {
      method: 'DELETE',
      cache: 'no-store',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify({ access_token: input.accessToken }),
    }
  );
  // 404 is what GitHub says about a token it has already forgotten, which is the
  // outcome this asked for. Nothing else here is worth failing a sign-out over.
  if (!response.ok && response.status !== 404) {
    throw new OAuthError(
      `http_${response.status}`,
      m.github_app_github_would_not_revoke_that_token()
    );
  }
}

async function spendGrant(
  config: GitHubAppConfig,
  now: number,
  fields: Record<string, string>
): Promise<OAuthTokenGrant> {
  return spendOAuthGrant({
    url: TOKEN_URL,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    fields,
    now,
    forge: 'GitHub',
    readAnswer: async (response) => {
      if (!response.ok) {
        throw new OAuthError(
          `http_${response.status}`,
          m.github_app_github_answered_for_that_token_request({
            status: response.status,
          })
        );
      }
      const answer = (await response.json()) as OAuthTokenResponse;
      // GitHub's refusal is a 200 with an `error` field, so the status alone
      // says nothing and the body decides.
      if (answer.error != null) {
        throw new OAuthError(
          answer.error,
          answer.error_description ??
            m.github_app_github_refused_that({ error: answer.error })
        );
      }
      return answer;
    },
  });
}
