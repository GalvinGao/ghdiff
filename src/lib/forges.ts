// The two forges ghdiff reads, and how a repository on one is named.
//
// These shapes are shared by the RPC contract (which validates them), the
// server (which dispatches on them) and the client (which builds them), and
// they are wire-only: nothing here is persisted, so they may change as long
// as both sides move together.

import type { ExampleEntry } from './exampleTargets';
import { GITHUB_HOST_ALIAS, GITHUB_HOSTS, isGitHubHost } from './github/hosts';
import type { ForgeTarget, GitLabTarget, ReviewTarget } from './reviewTarget';
import { formatList } from '@/lib/locale';
import { m } from '@/paraglide/messages.js';

export type ForgeName = 'github' | 'gitlab';

/**
 * Which forge a target kind belongs to — the one table. Exhaustive by
 * construction: a new kind fails the `satisfies` here before it can ship.
 */
const FORGE_OF_KIND = {
  'github-pull': 'github',
  'github-commit': 'github',
  'github-compare': 'github',
  'gitlab-mr': 'gitlab',
  'gitlab-commit': 'gitlab',
  'gitlab-compare': 'gitlab',
} as const satisfies Record<ForgeTarget['kind'], ForgeName>;

/** The forge a target lives on. */
export function forgeOfTarget(target: ForgeTarget): ForgeName {
  return FORGE_OF_KIND[target.kind];
}

/** True for the GitLab kinds, and narrows either way it answers. */
export function isGitLabTarget(target: ReviewTarget): target is GitLabTarget {
  return target.kind !== 'local-diff' && forgeOfTarget(target) === 'gitlab';
}

/**
 * Which forge's URL grammar a host speaks: GitHub's one host, spelled with or
 * without its `www.`, reads GitHub's paths; every other host reads GitLab's
 * `/-/` grammar. Which hosts a deployment SERVES is the forge gate's separate
 * question, answered per request.
 */
export function forgeOfHost(host: string): ForgeName {
  const wanted = host.toLowerCase();
  return isGitHubHost(wanted) || wanted === GITHUB_HOST_ALIAS
    ? 'github'
    : 'gitlab';
}

/** A ref's GitLab instance host, or undefined when the ref is GitHub's. */
export function gitLabHostOf(ref: {
  forge: ForgeName;
  host?: string;
}): string | undefined {
  return ref.forge === 'gitlab' ? ref.host : undefined;
}

/** The forge's own name, for "Open on GitLab" and its kin. */
export function forgeLabel(forge?: ForgeName): 'GitHub' | 'GitLab' {
  return forge === 'gitlab' ? 'GitLab' : 'GitHub';
}

export type RepoRef =
  | { forge: 'github'; owner: string; repo: string }
  | { forge: 'gitlab'; host: string; project: string };

export type PullRef = RepoRef & { number: number };

/**
 * What a target can do with comments, drafts, and verdicts.
 *
 * A pull request or a merge request has a review thread on its forge:
 * comments post there, drafts wait on the forge for the verdict, and a
 * verdict exists to publish them. A commit and a compare range have none of
 * that — no thread to post to, no draft to wait, no verdict to publish with —
 * so their comments stay in this browser and the composer says so.
 */
export interface ReviewCapabilities {
  commentStore: 'forge' | 'local';
}

/** The capabilities a target carries: a forge comment store exactly when it is a pull or a merge request. */
export function reviewCapabilities(target: ReviewTarget): ReviewCapabilities {
  return {
    commentStore: pullRefFromTarget(target) == null ? 'local' : 'forge',
  };
}

/** The repository a target points at, as the contract names it. */
export function repoRefFromTarget(target: ForgeTarget): RepoRef {
  if (isGitLabTarget(target)) {
    return { forge: 'gitlab', host: target.host, project: target.project };
  }
  return { forge: 'github', owner: target.owner, repo: target.repo };
}

/** The merge request or pull request a target points at, when it is one. */
export function pullRefFromTarget(target: ReviewTarget): PullRef | undefined {
  if (target.kind === 'github-pull') {
    return {
      forge: 'github',
      owner: target.owner,
      repo: target.repo,
      number: target.number,
    };
  }
  if (target.kind === 'gitlab-mr') {
    return {
      forge: 'gitlab',
      host: target.host,
      project: target.project,
      number: target.number,
    };
  }
  return undefined;
}

/**
 * A ref as the parts of a shared query's key. The cache hashes keys as JSON
 * across tabs and takes strings and numbers only, so a ref spreads into one
 * rather than riding as an object; the forge leads, so a GitHub repository and
 * a GitLab project of the same name never share an answer.
 */
export function refQueryKey(ref: RepoRef | PullRef): (string | number)[] {
  const repo =
    ref.forge === 'github'
      ? ['github', ref.owner, ref.repo]
      : ['gitlab', ref.host.toLowerCase(), ref.project];
  return 'number' in ref ? [...repo, ref.number] : repo;
}

/** A repository as a short label: `owner/repo`, or `host:project`. */
export function formatRepoRef(ref: RepoRef): string {
  return ref.forge === 'github'
    ? `${ref.owner}/${ref.repo}`
    : `${ref.host}:${ref.project}`;
}

/**
 * The key of the forge group a ref or row belongs to: `github`, or
 * `gitlab:<host>`. Two GitLab hosts are two credentials and two viewers, so
 * they are never one group.
 */
export function forgeGroupKey(row: {
  forge?: ForgeName;
  host?: string;
}): string {
  return row.forge === 'gitlab' ? `gitlab:${row.host}` : 'github';
}

/**
 * The entry of a GitLab host list that `host` names, matched without case —
 * the list's own spelling is the one the answer keeps. The list is the plain
 * host names, or entries carrying one.
 */
export function findGitLabHost<T extends string | { host: string }>(
  hosts: readonly T[],
  host: string
): T | undefined {
  const wanted = host.toLowerCase();
  return hosts.find(
    (entry) =>
      (typeof entry === 'string' ? entry : entry.host).toLowerCase() === wanted
  );
}

/**
 * What one deployment serves, learned by the client at runtime: whether GitHub
 * sign-in is on offer and whether GitHub is served at all, and the GitLab
 * hosts it answers for with whether each has an OAuth application to sign in
 * through. A host without one is a PAT host. The client secret never leaves
 * the server. `examples` holds the home page's example diffs, already narrowed
 * to the hosts this deployment serves.
 */
export interface InstanceInfo {
  github: { oauth: boolean; served: boolean };
  gitlab: { hosts: { host: string; oauth: boolean }[] };
  examples: { host: string; rows: ExampleEntry[] }[];
}

/**
 * The GitLab hosts a deployment serves, out of the instance answer.
 */
export function gitLabHostNames(info: InstanceInfo): string[] {
  return info.gitlab.hosts.map((entry) => entry.host);
}

/**
 * What a deployment serves, as one sentence: the forge gate's 404 on the
 * server, and every "not here" answer on the client. Both sides read it from
 * this one function, so the gate and the page cannot drift.
 */
export function servesSentenceFor(info: {
  github: { served: boolean };
  gitlab: { hosts: readonly { host: string }[] };
}): string {
  const github = info.github.served;
  const hosts = info.gitlab.hosts.map((entry) => entry.host);
  const githubHosts = formatList([...GITHUB_HOSTS]);
  if (github && hosts.length === 0) {
    return m.forges_serves_github({ github: githubHosts });
  }
  if (github) {
    return m.forges_serves_github_and_gitlab({
      github: githubHosts,
      hosts: formatList(hosts),
    });
  }
  if (hosts.length > 0) {
    return m.forges_serves_gitlab({ hosts: formatList(hosts) });
  }
  return m.forges_serves_nothing();
}
