// The three calls the App makes about its own credentials: spend a code, spend a
// refresh token, and revoke an access token. Nothing else here talks to GitHub.
//
// The token endpoint is not on `api.github.com` and does not behave like it. It
// answers 200 with an `error` field for a code that has been spent, a verifier
// that does not match, and a refresh token somebody already used — so the status
// alone says nothing, and `GitHubAuthError` carries GitHub's own error code up to
// the route. `/api/auth/refresh` reads that code: one value of it means another
// tab won a race, and every other value means the session is over.

import { TOKEN_URL } from '../githubApp.ts';
import { USER_AGENT } from './github.ts';

/** What the App is, as a deployment configures it. */
export interface AppConfig {
  clientId: string;
  clientSecret: string;
  /** The App's name in a URL, for the install link. */
  slug: string;
}

/** GitHub's answer when a code or a refresh token is spent successfully. */
export interface TokenGrant {
  accessToken: string;
  /** Absent when the App has user-to-server token expiry turned off. */
  accessExpiresAt?: number;
  refreshToken?: string;
  refreshExpiresAt?: number;
}

/**
 * GitHub's own name for what went wrong. The one worth naming is the answer to
 * a refresh token that has already been spent: it is what a second tab gets when
 * the first one refreshed a moment earlier, and it is not a reason to sign
 * anybody out.
 */
export const REFRESH_ALREADY_SPENT = 'bad_refresh_token';

export class GitHubAuthError extends Error {
  /** GitHub's `error` field, or `http_<status>` when it sent none. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GitHubAuthError';
    this.code = code;
  }
}

/**
 * What this deployment was given, or nothing at all. Nothing is a valid state
 * and not an error: a deployment with no App registered still serves every
 * public diff, and `GITHUB_TOKEN` still covers a single-user one. What it cannot
 * do is sign anybody in, and the sign-in button is what disappears.
 */
export function readAppConfig(): AppConfig | undefined {
  const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET?.trim();
  const slug = process.env.GITHUB_APP_SLUG?.trim();
  if (
    clientId == null ||
    clientId.length === 0 ||
    clientSecret == null ||
    clientSecret.length === 0 ||
    slug == null ||
    slug.length === 0
  ) {
    return undefined;
  }
  return { clientId, clientSecret, slug };
}

/** A code from the callback, for a session. */
export function exchangeCode(input: {
  code: string;
  config: AppConfig;
  now: number;
  redirectUri: string;
  verifier: string;
}): Promise<TokenGrant> {
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
  config: AppConfig;
  now: number;
  refreshToken: string;
}): Promise<TokenGrant> {
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
  config: AppConfig;
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
    throw new GitHubAuthError(
      `http_${response.status}`,
      'GitHub would not revoke that token.'
    );
  }
}

/** What GitHub answers with, before it is turned into absolute moments. */
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

async function spendGrant(
  config: AppConfig,
  now: number,
  fields: Record<string, string>
): Promise<TokenGrant> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    ...fields,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      // Without this GitHub answers form-encoded, which is its own default and
      // nobody's preference.
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      // workerd sends no User-Agent of its own, and GitHub answers a request
      // without one with 403 "Request forbidden by administrative rules".
      'user-agent': USER_AGENT,
    },
    body,
  });

  if (!response.ok) {
    throw new GitHubAuthError(
      `http_${response.status}`,
      `GitHub answered ${response.status} for that token request.`
    );
  }

  const answer = (await response.json()) as TokenResponse;
  if (answer.error != null) {
    throw new GitHubAuthError(
      answer.error,
      answer.error_description ?? `GitHub refused that: ${answer.error}.`
    );
  }
  if (answer.access_token == null || answer.access_token.length === 0) {
    throw new GitHubAuthError(
      'no_access_token',
      'GitHub answered with no access token.'
    );
  }

  return {
    accessToken: answer.access_token,
    accessExpiresAt: absolute(answer.expires_in, now),
    refreshToken:
      answer.refresh_token != null && answer.refresh_token.length > 0
        ? answer.refresh_token
        : undefined,
    refreshExpiresAt: absolute(answer.refresh_token_expires_in, now),
  };
}

/**
 * A life in seconds, as the moment it ends. GitHub states a duration and this
 * app stores an instant: a duration is only true at the moment it was read, and
 * the cookie outlives that moment by eight hours. An App with expiry turned off
 * states no duration at all, and the answer to that is nothing rather than now.
 */
function absolute(
  seconds: number | undefined,
  now: number
): number | undefined {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds))
    return undefined;
  return now + seconds * 1000;
}
