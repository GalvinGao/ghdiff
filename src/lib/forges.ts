// The forge ghdiff reads, and how a repository on it is named.
//
// These shapes are shared by the RPC contract (which validates them), the
// server (which dispatches on them) and the client (which builds them), and
// they are wire-only: nothing here is persisted, so they may change as long
// as both sides move together.

import type { ExampleEntry } from './exampleTargets';
import { GITHUB_HOST_ALIAS, GITHUB_HOSTS, isGitHubHost } from './github/hosts';
import type { ForgeTarget, ReviewTarget } from './reviewTarget';
import { formatList } from '@/lib/locale';
import { m } from '@/paraglide/messages.js';

export type ForgeName = 'github';

/**
 * Which forge a target kind belongs to — the one table. Exhaustive by
 * construction: a new kind fails the `satisfies` here before it can ship.
 */
const FORGE_OF_KIND = {
  'github-pull': 'github',
  'github-commit': 'github',
  'github-compare': 'github',
} as const satisfies Record<ForgeTarget['kind'], ForgeName>;

/** The forge a target lives on. */
export function forgeOfTarget(target: ForgeTarget): ForgeName {
  return FORGE_OF_KIND[target.kind];
}

/**
 * Which forge's URL grammar a host speaks: GitHub's one host, spelled with or
 * without its `www.`, reads GitHub's paths, and no other host names a forge.
 * Which hosts a deployment SERVES is the forge gate's separate question,
 * answered per request.
 */
export function forgeOfHost(host: string): ForgeName | undefined {
  const wanted = host.toLowerCase();
  return isGitHubHost(wanted) || wanted === GITHUB_HOST_ALIAS
    ? 'github'
    : undefined;
}

/** The forge's own name, for "Open on GitHub" and its kin. */
export function forgeLabel(_forge?: ForgeName): 'GitHub' {
  return 'GitHub';
}

export type RepoRef = { forge: 'github'; owner: string; repo: string };

export type PullRef = RepoRef & { number: number };

/**
 * What a target can do with comments and verdicts.
 *
 * A pull request has a review thread on its forge: comments post there, and a
 * verdict is submitted to it. A commit and a compare range have none of that —
 * no thread to post to, no verdict to submit — so their comments stay in this
 * browser and the composer says so.
 */
export interface ReviewCapabilities {
  commentStore: 'forge' | 'local';
}

/** The capabilities a target carries: a forge comment store exactly when it is a pull request. */
export function reviewCapabilities(target: ReviewTarget): ReviewCapabilities {
  return {
    commentStore: pullRefFromTarget(target) == null ? 'local' : 'forge',
  };
}

/** The repository a target points at, as the contract names it. */
export function repoRefFromTarget(target: ForgeTarget): RepoRef {
  return { forge: 'github', owner: target.owner, repo: target.repo };
}

/** The pull request a target points at, when it is one. */
export function pullRefFromTarget(target: ReviewTarget): PullRef | undefined {
  if (target.kind === 'github-pull') {
    return {
      forge: 'github',
      owner: target.owner,
      repo: target.repo,
      number: target.number,
    };
  }
  return undefined;
}

/**
 * A ref as the parts of a shared query's key. The cache hashes keys as JSON
 * across tabs and takes strings and numbers only, so a ref spreads into one
 * rather than riding as an object; the forge leads, so a repository of the same
 * name on another forge would never share an answer.
 */
export function refQueryKey(ref: RepoRef | PullRef): (string | number)[] {
  const repo = [ref.forge, ref.owner, ref.repo];
  return 'number' in ref ? [...repo, ref.number] : repo;
}

/** A repository as a short label: `owner/repo`. */
export function formatRepoRef(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}`;
}

/**
 * The key of the forge group a ref or row belongs to: one credential and one
 * viewer each. GitHub is one group, `github`.
 */
export function forgeGroupKey(_row: object): string {
  return 'github';
}

/**
 * What one deployment serves, learned by the client at runtime: whether GitHub
 * sign-in is on offer and whether GitHub is served at all. The client secret
 * never leaves the server. `examples` holds the home page's example diffs,
 * already narrowed to the hosts this deployment serves.
 */
export interface InstanceInfo {
  github: { oauth: boolean; served: boolean };
  examples: { host: string; rows: ExampleEntry[] }[];
}

/**
 * What a deployment serves, as one sentence: the forge gate's 404 on the
 * server, and every "not here" answer on the client. Both sides read it from
 * this one function, so the gate and the page cannot drift.
 */
export function servesSentenceFor(info: {
  github: { served: boolean };
}): string {
  if (info.github.served) {
    return m.forges_serves_github({ github: formatList([...GITHUB_HOSTS]) });
  }
  return m.forges_serves_nothing();
}
