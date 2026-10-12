// The userscript, filled for this deployment. The template in `ghdiff.user.js`
// is deployment-blind — a self-hosted deployment's button must open that
// deployment, and its `@match` list must name the hosts it serves. Both come
// from this one function, so the route that serves it stays one line.

import { GITHUB_HOSTS } from '@/lib/github/hosts';

/**
 * The userscript for this deployment: its own origin in the metadata and the
 * button's target, and one `@match` per host served. A match pattern is
 * port-agnostic, so a host's port is stripped from the pattern (the script
 * itself reads `location.host`, and the port survives there).
 */
export function buildUserscript(template: string, origin: string): string {
  const matches = [
    ...new Set(GITHUB_HOSTS.map((host) => host.split(':')[0])),
  ].map((hostname) => `// @match        https://${hostname}/*`);
  return template
    .replaceAll('__GHDIFF_ORIGIN__', () => origin)
    .replace('// @match        __GHDIFF_MATCHES__', matches.join('\n'));
}
