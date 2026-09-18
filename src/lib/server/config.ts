// The deployment's configuration, parsed from the environment at each request
// boundary and passed down as a plain parameter.
//
// The GitHub App and `GITHUB_TOKEN` are the whole of it, and either may be
// absent: no App means no sign-in, and no token means anonymous reads. The
// loud-vs-silent rule is the deployment's philosophy: a value that says
// something impossible — half an App — throws, because that is a typo and a
// loud failure is what tells somebody so. Everything else is absent-tolerant:
// unset reads as none, and the module that asked decides what absence means
// (no sign-in, anonymous reads, a counter kept in memory). The keyring's byte
// floor is not checked here: a key is validated beside the cipher that derives
// from it, in `session.ts`.
//
// There is no process-wide cache and no test override. A parse costs
// microseconds, so each boundary parses for itself and hands the result down,
// and a test constructs the deployment it means as a plain value.

import { z } from 'zod';

/** The GitHub App this deployment signs reviewers in through, when it has one. */
export interface GitHubAppConfig {
  clientId: string;
  clientSecret: string;
  /** The App's name in a URL, for the install link. */
  slug?: string;
}

/** What one deployment serves, parsed out of its environment. */
export interface DeploymentConfig {
  github: {
    /** The App, when both halves of it are set. No App, no sign-in. */
    app?: GitHubAppConfig;
    /** The fallback token, for a single-user deployment. */
    token?: string;
  };
  /**
   * The keys `SESSION_SECRET` names, newest first: split on commas, trimmed,
   * empties dropped. Whether each one is a key at all is answered beside the
   * cipher, in `session.ts`.
   */
  sessionKeyring: string[];
}

/** Unset, empty, and whitespace-only all read as absent; anything else trims. */
function normalized(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  return value.length === 0 ? undefined : value;
}

/** An optional variable whose value carries no rule of its own. */
const optionalValue = z.preprocess(normalized, z.string().optional());

const envSchema = z.object({
  SESSION_SECRET: optionalValue,
  GITHUB_TOKEN: optionalValue,
  GITHUB_APP_CLIENT_ID: optionalValue,
  GITHUB_APP_CLIENT_SECRET: optionalValue,
  GITHUB_APP_SLUG: optionalValue,
});

/**
 * The GitHub half. Half an App signs nothing, and that is a typo like any
 * other: a loud failure is what tells somebody so.
 */
function parseGitHub(
  env: z.infer<typeof envSchema>
): DeploymentConfig['github'] {
  const {
    GITHUB_APP_CLIENT_ID: clientId,
    GITHUB_APP_CLIENT_SECRET: clientSecret,
    GITHUB_APP_SLUG: slug,
    GITHUB_TOKEN: token,
  } = env;
  if ((clientId == null) !== (clientSecret == null)) {
    throw new Error(
      'GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET come as a pair.'
    );
  }
  return {
    ...(token == null ? {} : { token }),
    ...(clientId == null || clientSecret == null
      ? {}
      : {
          app: {
            clientId,
            clientSecret,
            ...(slug == null ? {} : { slug }),
          },
        }),
  };
}

/**
 * The deployment's configuration, validated. Unknown variables are ignored —
 * the process's whole environment is always a superset of what this app reads.
 */
export function parseDeploymentConfig(
  env: Record<string, string | undefined>
): DeploymentConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(z.prettifyError(result.error));
  }
  const parsed = result.data;
  return {
    github: parseGitHub(parsed),
    sessionKeyring: (parsed.SESSION_SECRET ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  };
}
