// The deployment's configuration, parsed from the environment at each request
// boundary and passed down as a plain parameter.
//
// One deployment serves GitHub and any number of GitLab hosts. `GITLAB_HOSTS`
// names them as a JSON array, each with the OAuth application registered on it
// when it has one; a host without one still works — its public projects read
// anonymously, and reviewers connect to it with a personal access token. The
// GitHub App and `GITHUB_TOKEN` are the GitHub half, and GitHub is served
// while either is set: no App means no sign-in, and neither means no GitHub at
// all — a GitHub ref takes the same 404 an unconfigured GitLab host does.
//
// The loud-vs-silent rule is the deployment's philosophy: a value that says
// something impossible — JSON that does not parse, a host that is not a host,
// the same host twice, half an OAuth pair — throws, because that is a typo and
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
import { findGitLabHost, forgeOfHost, servesSentenceFor } from '@/lib/forges';
import { reviewInputFrom } from '@/lib/resolveHost';
import { HOST_PATTERN } from '@/lib/reviewTarget';

/** The GitHub App this deployment signs reviewers in through, when it has one. */
export interface GitHubAppConfig {
  clientId: string;
  clientSecret: string;
  /** The App's name in a URL, for the install link. */
  slug?: string;
}

/** One GitLab host this deployment serves. */
export interface GitLabHostConfig {
  /** The instance's hostname, with an optional port: `gitlab.corp.com:8443`. */
  host: string;
  /** The OAuth application's id and secret, when one is registered. */
  clientId?: string;
  clientSecret?: string;
}

/** What one deployment serves, parsed out of its environment. */
export interface DeploymentConfig {
  github: {
    /** The App, when both halves of it are set. No App, no sign-in. */
    app?: GitHubAppConfig;
    /** The fallback token, for a single-user deployment. */
    token?: string;
  };
  /** The GitLab hosts this deployment answers for, in configured order. */
  gitlabHosts: GitLabHostConfig[];
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
  GITLAB_HOSTS: optionalValue,
  GHDIFF_EXAMPLES: optionalValue,
  GHDIFF_BRANDING: optionalValue,
  SESSION_SECRET: optionalValue,
  GITHUB_TOKEN: optionalValue,
  GITHUB_APP_CLIENT_ID: optionalValue,
  GITHUB_APP_CLIENT_SECRET: optionalValue,
  GITHUB_APP_SLUG: optionalValue,
});

/**
 * The most GitLab hosts one deployment names. Every connection rides the one
 * session cookie, and a browser keeps a cookie only up to 4096 bytes: the
 * GitHub grant and the cookie's attributes take about 550 of them, and each
 * GitLab OAuth grant — two 64-character tokens, their clocks, and a host of
 * some 36 characters — about 380 more, so eight connections seal to about
 * 3.6 KB and leave room for longer hosts. A ninth entry fails the config,
 * loudly, rather than turning up later as a sign-in whose cookie the browser
 * silently drops. `session/index.test.ts` seals the eight to hold the sum.
 */
export const MAX_GITLAB_HOSTS = 8;

/**
 * Whether a value is a host: the pattern's shape, and read back as itself by
 * the URL parser — which is what refuses a port past 65535, a leading zero,
 * or a default port that would vanish from every address built on it.
 */
function isHost(host: string): boolean {
  if (!HOST_PATTERN.test(host)) return false;
  try {
    const url = new URL(`https://${host}`);
    return url.host === host && url.port !== '0';
  } catch {
    return false;
  }
}

/** One entry of the `GITLAB_HOSTS` array. */
const gitLabHostEntry = z.object({
  host: z.preprocess(
    (raw) => (typeof raw === 'string' ? raw.trim().toLowerCase() : raw),
    z.string().refine(isHost, {
      error: (issue) =>
        `GITLAB_HOSTS holds a value that is not a valid host: ${String(issue.input)}`,
    })
  ),
  clientId: optionalValue,
  clientSecret: optionalValue,
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
 * The GitLab hosts, out of the JSON array `GITLAB_HOSTS` holds. Absent, empty,
 * and `[]` all read as none — a GitHub-only deployment. What throws is a value
 * that says something impossible: JSON that does not parse, an entry that is
 * not a host, the same host twice, half an OAuth pair, or more hosts than one
 * cookie can hold a sign-in to.
 */
function parseGitLabHosts(raw: string | undefined): GitLabHostConfig[] {
  if (raw == null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The raw value stays out of the message: it carries OAuth client secrets.
    throw new Error('GITLAB_HOSTS is not valid JSON.');
  }
  const result = z
    .array(gitLabHostEntry)
    .max(MAX_GITLAB_HOSTS, {
      error: `GITLAB_HOSTS names more than ${MAX_GITLAB_HOSTS} hosts, and one session cookie cannot hold a sign-in to each.`,
    })
    .safeParse(parsed);
  if (!result.success) {
    throw new Error(z.prettifyError(result.error));
  }
  const hosts: GitLabHostConfig[] = [];
  const seen = new Set<string>();
  for (const entry of result.data) {
    if (seen.has(entry.host)) {
      throw new Error(`GITLAB_HOSTS names ${entry.host} twice.`);
    }
    seen.add(entry.host);
    const { host, clientId, clientSecret } = entry;
    if (clientId != null && clientSecret != null) {
      hosts.push({ host, clientId, clientSecret });
    } else if (clientId != null || clientSecret != null) {
      throw new Error(
        `GITLAB_HOSTS entry for ${host}: clientId and clientSecret come as a pair.`
      );
    } else {
      hosts.push({ host });
    }
  }
  return hosts;
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
  raw: string | undefined,
  gitlabHosts: GitLabHostConfig[]
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
    if (
      forgeOfHost(host) === 'gitlab' &&
      findGitLabHost(gitlabHosts, host) == null
    ) {
      throw new Error(
        `GHDIFF_EXAMPLES names ${key}, which this deployment does not serve.`
      );
    }
    for (const row of rows) {
      if (
        reviewInputFrom(`https://${host}/${row.path}`, {
          gitlabHosts: [host],
        }).kind !== 'target'
      ) {
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
  const gitlabHosts = parseGitLabHosts(parsed.GITLAB_HOSTS);
  return {
    github: parseGitHub(parsed),
    gitlabHosts,
    examples: parseExamples(parsed.GHDIFF_EXAMPLES, gitlabHosts),
    branding: parsed.GHDIFF_BRANDING ?? DEFAULT_BRANDING,
    sessionKeyring: (parsed.SESSION_SECRET ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  };
}

/** The configured GitLab host `host` names, matched case-insensitively. */
export function gitLabHostFor(
  config: DeploymentConfig,
  host: string
): GitLabHostConfig | undefined {
  const wanted = host.toLowerCase();
  return config.gitlabHosts.find((entry) => entry.host === wanted);
}

/** The configured GitLab hosts as one comma-joined list, for a sentence. */
export function gitLabHostsLabel(config: DeploymentConfig): string {
  return config.gitlabHosts.map((entry) => entry.host).join(', ');
}

/**
 * GitHub is served while there is anything to read it with: the App, or the
 * fallback token. Neither means no GitHub at all — the forge gate answers a
 * GitHub ref with the same 404 an unconfigured GitLab host gets.
 */
export function githubServed(config: DeploymentConfig): boolean {
  return config.github.app != null || config.github.token != null;
}

/**
 * What this deployment serves, as one sentence: the forge gate's 404, and the
 * list every "not here" answer names its hosts from.
 */
export function servesSentence(config: DeploymentConfig): string {
  return servesSentenceFor({
    github: { served: githubServed(config) },
    gitlab: { hosts: config.gitlabHosts },
  });
}
