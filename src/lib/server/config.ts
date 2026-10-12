// The deployment's configuration, parsed from the environment at each request
// boundary and passed down as a plain parameter.
//
// The GitHub App and `GITHUB_TOKEN` say how this deployment reads GitHub, and
// GitHub is served while either is set: no App means no sign-in, and neither
// means no GitHub at all — a GitHub ref takes the forge gate's 404.
//
// The loud-vs-silent rule is the deployment's philosophy: a value that says
// something impossible — JSON that does not parse, a host this deployment does
// not serve, half an OAuth pair — throws, because that is a typo and
// a loud failure is what tells somebody so. Everything else is absent-tolerant:
// unset reads as none, and the module that asked decides what absence means
// (no sign-in, anonymous reads, a counter kept in memory). The keyring's byte
// floor is not checked here: a key is validated beside the cipher that derives
// from it, in `session.ts`.
//
// There is no process-wide cache and no test override. A parse costs
// microseconds, so each boundary parses for itself and hands the result down,
// and a test constructs the deployment it means as a plain value.

import { z } from 'zod';

import { DEFAULT_EXAMPLES, type ExampleEntry } from '@/lib/exampleTargets';
import { forgeOfHost, servesSentenceFor } from '@/lib/forges';
import { reviewInputFrom } from '@/lib/resolveHost';

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
  /** The example diffs the home page offers, keyed by the host they open on. */
  examples: Record<string, readonly ExampleEntry[]>;
  /**
   * What this deployment calls itself on screen: the home page's heading and
   * the way home from `/setup`. A label and nothing else — every address the
   * app builds comes from the request it answers.
   */
  branding: string;
  /**
   * The keys `SESSION_SECRET` names, newest first: split on commas, trimmed,
   * empties dropped. Whether each one is a key at all is answered beside the
   * cipher, in `session.ts`.
   */
  sessionKeyring: string[];
}

/** What a deployment calls itself when `GHDIFF_BRANDING` says nothing. */
export const DEFAULT_BRANDING = 'ghdiff.com';

/** Unset, empty, and whitespace-only all read as absent; anything else trims. */
function normalized(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  return value.length === 0 ? undefined : value;
}

/** An optional variable whose value carries no rule of its own. */
const optionalValue = z.preprocess(normalized, z.string().optional());

const envSchema = z.object({
  GHDIFF_EXAMPLES: optionalValue,
  GHDIFF_BRANDING: optionalValue,
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

/** One row of a `GHDIFF_EXAMPLES` host list. */
const exampleEntry = z.object({
  title: z.string().min(1),
  path: z.string().min(1),
  scale: z.string().min(1),
  note: z.string().min(1),
});

/**
 * The example diffs a deployment offers, out of the JSON object
 * `GHDIFF_EXAMPLES` holds: host to rows, each row naming its target as the
 * forge's own path. Absent reads as the built-in catalog. What throws is a
 * value that says something impossible: JSON that does not parse, an entry
 * that is not four non-empty strings, the same host twice, a host this
 * deployment does not serve, or a path that is no target on its host.
 */
function parseExamples(
  raw: string | undefined
): Record<string, readonly ExampleEntry[]> {
  if (raw == null) return DEFAULT_EXAMPLES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('GHDIFF_EXAMPLES is not valid JSON.');
  }
  const result = z.record(z.string(), z.array(exampleEntry)).safeParse(parsed);
  if (!result.success) {
    throw new Error(z.prettifyError(result.error));
  }
  const catalog: Record<string, ExampleEntry[]> = {};
  const seen = new Set<string>();
  for (const [key, rows] of Object.entries(result.data)) {
    const host = key.toLowerCase();
    if (seen.has(host)) {
      throw new Error(`GHDIFF_EXAMPLES names ${key} twice.`);
    }
    seen.add(host);
    if (forgeOfHost(host) == null) {
      throw new Error(
        `GHDIFF_EXAMPLES names ${key}, which this deployment does not serve.`
      );
    }
    for (const row of rows) {
      if (reviewInputFrom(`https://${host}/${row.path}`).kind !== 'target') {
        throw new Error(
          `GHDIFF_EXAMPLES entry for ${host}: ${row.path} is not a review target on ${host}.`
        );
      }
    }
    catalog[host] = rows;
  }
  return catalog;
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
    examples: parseExamples(parsed.GHDIFF_EXAMPLES),
    branding: parsed.GHDIFF_BRANDING ?? DEFAULT_BRANDING,
    sessionKeyring: (parsed.SESSION_SECRET ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  };
}

/**
 * GitHub is served while there is anything to read it with: the App, or the
 * fallback token. Neither means no GitHub at all — the forge gate answers a
 * GitHub ref with a 404 that says so.
 */
export function githubServed(config: DeploymentConfig): boolean {
  return config.github.app != null || config.github.token != null;
}

/**
 * What this deployment serves, as one sentence: the forge gate's 404, and
 * every "not here" answer.
 */
export function servesSentence(config: DeploymentConfig): string {
  return servesSentenceFor({
    github: { served: githubServed(config) },
  });
}
