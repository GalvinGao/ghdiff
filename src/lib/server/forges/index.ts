import { githubForge } from './github';
import type { Forge } from './types';
import type { ForgeName, RepoRef } from '@/lib/forges';
import {
  type DeploymentConfig,
  githubServed,
  servesSentence,
} from '@/lib/server/config';
import { GitHubError } from '@/lib/server/github/client';

/**
 * Which forge answers for a repository ref. Tests register a fake in its
 * place, which is how the router's procedures are tested without a network.
 */
const forges = new Map<ForgeName, Forge>([['github', githubForge]]);

export function registerForge(name: ForgeName, forge: Forge): void {
  forges.set(name, forge);
}

export function forgeFor(config: DeploymentConfig, ref: RepoRef): Forge {
  // A ref answers only for a forge this deployment serves: GitHub while the
  // App or the fallback token is configured. Any other is a target this deployment has no route for, answered here
  // rather than at the forge — 404 is what it deserves, and the sentence says
  // what this instance does serve. The typed `not-served` rides along so the
  // client never reads this 404 as a missing repository.
  if (ref.forge === 'github' && !githubServed(config)) {
    throw new GitHubError(404, servesSentence(config), {
      reason: 'not-served',
      forge: 'github',
    });
  }
  return forgeNamed(ref.forge);
}

/** A forge by name, for the calls that name no repository — `viewer.get`. */
export function forgeNamed(name: ForgeName): Forge {
  // The map holds every name and `registerForge` only ever sets, so a miss is
  // not reachable; the cast says so.
  return forges.get(name) as Forge;
}
