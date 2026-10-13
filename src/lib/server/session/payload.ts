// What the JWE carries, stated as zod schemas, and how it becomes the
// `SessionPayload` the rest of the app knows.
//
// The two shapes are the same shape. JWT's own `iat` and `exp` carry the
// session's start and its 180-day ceiling — `jwtDecrypt` refuses an expired
// one before this module ever runs — and the credentials live under one `auth`
// claim, keyed by forge and then by host, exactly as the payload keys them:
//
// ```json
// {
//   "iat": 1789000000,
//   "exp": 1804552000,
//   "auth": {
//     "github": { "github.com": { "accessToken": "ghu_…", "refreshToken": "ghr_…" } },
//     "gitlab": { "gitlab.com": { "type": "oauth", "accessToken": "…" } }
//   }
// }
// ```
//
// `auth.github` is keyed by host for the day the GHES seam in
// `@/lib/github/hosts` widens; today exactly one key is ever written, and only
// that key is read — a grant under any other host is not a credential this
// deployment speaks with. The token-level clocks (`accessExpiresAt` and
// friends) stay in milliseconds inside the grant, because they are the
// forge's data rather than the JWT's, and `SessionPayload` keeps them in
// milliseconds everywhere else.

import { z } from 'zod';

import { GITHUB_HOSTS } from '@/lib/github/hosts';
import {
  type GitLabGrant,
  OAUTH_MAX_AGE_MS,
  type OAuthHandoff,
  SESSION_MAX_AGE_MS,
  type SessionPayload,
} from '@/lib/session';

const GITHUB_HOST = GITHUB_HOSTS[0];

const token = z.string().min(1);
const moment = z.number().finite();

const gitHubGrantSchema = z.object({
  accessToken: token,
  accessExpiresAt: moment.optional(),
  refreshToken: token.optional(),
  refreshExpiresAt: moment.optional(),
});

const gitLabGrantSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('oauth'),
    accessToken: token,
    accessExpiresAt: moment.optional(),
    refreshToken: token.optional(),
    refreshExpiresAt: moment.optional(),
  }),
  z.object({ type: z.literal('pat'), token: token }),
]);

// A grant that fails its shape parses as no grant — dropped, not fatal, the
// same leniency the legacy reader has.
const authSchema = z.object({
  github: z
    .record(z.string(), gitHubGrantSchema.optional().catch(undefined))
    .optional(),
  gitlab: z
    .record(z.string(), gitLabGrantSchema.optional().catch(undefined))
    .optional(),
});

export const sessionClaimsSchema = z.object({
  iat: z.number().finite(),
  exp: z.number().finite(),
  auth: authSchema,
});
export type SessionClaims = z.infer<typeof sessionClaimsSchema>;

export const handoffClaimsSchema = z.object({
  iat: z.number().finite(),
  exp: z.number().finite(),
  state: token,
  verifier: token,
  returnTo: token,
  forge: z.enum(['github', 'gitlab']).optional(),
  host: token.optional(),
});
export type HandoffClaims = z.infer<typeof handoffClaimsSchema>;

/**
 * The claims a session seals with: the credentials, keyed by forge and host,
 * and the session's own window — `iat` the sign-in, `exp` the end of the
 * ceiling above it, so a refresh re-seals the same window rather than rolling
 * it forward.
 */
export function sessionToClaims(payload: SessionPayload): SessionClaims {
  const auth: SessionClaims['auth'] = {};
  if (payload.github != null) {
    auth.github = { [GITHUB_HOST]: payload.github };
  }
  const gitlab = payload.gitlab;
  if (gitlab != null && Object.keys(gitlab).length > 0) {
    auth.gitlab = gitlab;
  }
  return {
    iat: Math.round(payload.issuedAt / 1000),
    exp: Math.round((payload.issuedAt + SESSION_MAX_AGE_MS) / 1000),
    auth,
  };
}

/**
 * The session a JWE's claims stand for, or nothing at all. The claims arrive
 * schema-parsed from the cipher; what is still refused here is a session with
 * no credential in it at all, because there is nothing in it to honour.
 */
export function sessionFromClaims(
  claims: SessionClaims
): SessionPayload | undefined {
  const github = claims.auth.github?.[GITHUB_HOST];

  const gitlab: Record<string, GitLabGrant> = {};
  for (const [host, grant] of Object.entries(claims.auth.gitlab ?? {})) {
    if (grant == null) continue;
    gitlab[host] =
      grant.type === 'pat'
        ? { type: 'pat', token: grant.token }
        : {
            type: 'oauth',
            accessToken: grant.accessToken,
            accessExpiresAt: grant.accessExpiresAt,
            refreshToken: grant.refreshToken,
            refreshExpiresAt: grant.refreshExpiresAt,
          };
  }

  if (github == null && Object.keys(gitlab).length === 0) return undefined;
  return {
    issuedAt: Math.round(claims.iat * 1000),
    github:
      github == null
        ? undefined
        : {
            accessToken: github.accessToken,
            accessExpiresAt: github.accessExpiresAt,
            refreshToken: github.refreshToken,
            refreshExpiresAt: github.refreshExpiresAt,
          },
    gitlab: Object.keys(gitlab).length > 0 ? gitlab : undefined,
  };
}

/** The claims a handoff seals with: its own fields, and its ten minutes. */
export function handoffToClaims(
  handoff: OAuthHandoff,
  nowMs: number
): HandoffClaims {
  return {
    ...handoff,
    iat: Math.round(nowMs / 1000),
    exp: Math.round((nowMs + OAUTH_MAX_AGE_MS) / 1000),
  };
}

/** The handoff a JWE's claims stand for. */
export function handoffFromClaims(claims: HandoffClaims): OAuthHandoff {
  return {
    state: claims.state,
    verifier: claims.verifier,
    returnTo: claims.returnTo,
    forge: claims.forge,
    host: claims.host,
  };
}
