// The userscript, filled for this deployment. The template in `ghdiff.user.js`
// is deployment-blind — a self-hosted deployment's button must open that
// deployment, and its `@match` list must name exactly the hosts this one
// serves, or the button would appear where a press cannot open here. Both
// come from this one function, so the route that serves it stays one line.

import { type DeploymentConfig, githubServed } from './config';
import { GITHUB_HOSTS } from '@/lib/github/hosts';

/**
 * The userscript for this deployment: its own origin in the metadata and the
 * button's target, and one `@match` per host served — github.com while GitHub
 * is served, then each GitLab host in configured order. A match pattern is
 * port-agnostic, so a host's port is stripped from the pattern, and the whole
 * list, ports kept, goes into the script too: it runs only where
 * `location.host` is one of them.
 */
export function buildUserscript(
  template: string,
  config: DeploymentConfig,
  origin: string
): string {
  const hosts = [
    ...(githubServed(config) ? GITHUB_HOSTS : []),
    ...config.gitlabHosts.map((entry) => entry.host),
  ];
  const matches = [...new Set(hosts.map((host) => host.split(':')[0]))].map(
    (hostname) => `// @match        https://${hostname}/*`
  );
  return template
    .replaceAll('__GHDIFF_ORIGIN__', () => origin)
    .replaceAll('__GHDIFF_HOSTS__', () => hosts.join(','))
    .replace('// @match        __GHDIFF_MATCHES__', matches.join('\n'));
}
