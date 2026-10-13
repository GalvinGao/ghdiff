// The half of an OAuth token endpoint both forges share: the form POST, the
// access-token presence check, and the seconds-to-moments conversion. What is
// not shared is how a refusal reads — GitHub answers 200 with an `error`
// field, GitLab a 4xx with the RFC 6749 error body — so each forge hands in
// the reader that turns its own answer into the grant's fields or throws its
// own `OAuthError`, and the per-forge error-code constants stay with it.

import { USER_AGENT } from './github/client';
import { m } from '@/paraglide/messages.js';

/**
 * What went wrong at a forge's token endpoint, carrying the forge's own error
 * code up to the route. The one code each forge names — a refresh token that
 * was already spent — is what the refresh route reads to tell a lost race from
 * a session that is over.
 */
export class OAuthError extends Error {
  /** The forge's `error` field, or `http_<status>` when it sent none. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'OAuthError';
    this.code = code;
  }
}

/** What a token endpoint answers with, before it is turned into moments. */
export interface OAuthTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

/** The grant a token answer holds, its durations as the moments they end. */
export interface OAuthTokenGrant {
  accessToken: string;
  accessExpiresAt?: number;
  refreshToken?: string;
  refreshExpiresAt?: number;
}

/**
 * Spends a code or a refresh token at a forge's token endpoint. `readAnswer`
 * is the forge's own seam: it throws the `OAuthError` its refusal shape
 * describes, or answers the parsed body the grant is read from. An answer
 * with no access token in it is a refusal whatever the status said.
 */
export async function spendOAuthGrant(input: {
  url: string;
  clientId: string;
  clientSecret: string;
  fields: Record<string, string>;
  now: number;
  /** The forge's name, for the sentence a tokenless answer surfaces with. */
  forge: string;
  readAnswer(response: Response): Promise<OAuthTokenResponse>;
}): Promise<OAuthTokenGrant> {
  const response = await fetch(input.url, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      // Without this GitHub answers form-encoded, which is its own default
      // and nobody's preference.
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      // workerd sends no User-Agent of its own, and GitHub answers a request
      // without one with 403 "Request forbidden by administrative rules".
      'user-agent': USER_AGENT,
    },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      ...input.fields,
    }),
  });

  const answer = await input.readAnswer(response);
  if (answer.access_token == null || answer.access_token.length === 0) {
    throw new OAuthError(
      'no_access_token',
      m.oauth_forge_answered_with_no_access_token({ forge: input.forge })
    );
  }

  return {
    accessToken: answer.access_token,
    accessExpiresAt: absolute(answer.expires_in, input.now),
    refreshToken:
      answer.refresh_token != null && answer.refresh_token.length > 0
        ? answer.refresh_token
        : undefined,
    refreshExpiresAt: absolute(answer.refresh_token_expires_in, input.now),
  };
}

/**
 * A life in seconds, as the moment it ends. A forge states a duration and
 * this app stores an instant: a duration is only true at the moment it was
 * read, and the cookie outlives that moment by hours. A forge with expiry
 * turned off states no duration at all, and the answer to that is nothing
 * rather than now.
 */
function absolute(
  seconds: number | undefined,
  now: number
): number | undefined {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds))
    return undefined;
  return now + seconds * 1000;
}
