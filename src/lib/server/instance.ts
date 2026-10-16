// What this deployment serves, mapped out of its configuration. The value is
// the client's one answer to "does this ghdiff offer GitHub sign-in, is GitHub
// served at all" — a fact about the
// deployment itself, so it is computed from the config alone and owes nothing
// to whoever is asking.

import { type DeploymentConfig, githubServed } from './config';
import type { InstanceInfo } from '@/lib/forges';
import { GITHUB_HOSTS } from '@/lib/github/hosts';

/**
 * What this deployment serves, as one plain value: whether GitHub sign-in is
 * on offer (an App is configured) and whether GitHub is served at all (the
 * App or the fallback token), and the example diffs for the home page,
 * narrowed to the hosts served. The client secret never leaves the server.
 */
export function instanceInfoFromConfig(config: DeploymentConfig): InstanceInfo {
  const examples: InstanceInfo['examples'] = [];
  const group = (host: string) => {
    const rows = config.examples[host];
    if (rows != null && rows.length > 0) {
      examples.push({ host, rows: [...rows] });
    }
  };
  if (githubServed(config)) group(GITHUB_HOSTS[0]);
  return {
    github: {
      // A sign-in needs a key to seal the session with as well as the App.
      oauth: config.github.app != null && config.sessionKeyring.length > 0,
      served: githubServed(config),
    },
    examples,
  };
}
