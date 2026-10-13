// The GitHub hosts a deployment serves. Today exactly one exists —
// github.com — and that singularity is load-bearing: a hostless GitHub path
// (`/owner/repo/pull/123`) canonicalizes without probing, because it can
// only mean one host. This module is the marked GHES seam: when GitHub
// Enterprise Server support lands, the list becomes configured and probed
// the way GitLab hosts are, `GitHubRepoRef` gains a `host` field, and the
// hostless canonicalization goes through the same resolve step a bare
// GitLab path does. Until then every GitHub host answer lives here, so the
// URL grammar and the server's serves-sentence cannot drift apart.

/** The GitHub hosts this deployment serves, in canonical order. */
export const GITHUB_HOSTS = ['github.com'] as const;

/**
 * The served host's one alias, spelled the way some links do. Never a served
 * host itself — the URL grammars accept it and nothing else names it.
 */
export const GITHUB_HOST_ALIAS = 'www.github.com';

/** True when `host` names a served GitHub host, case-insensitively. */
export function isGitHubHost(host: string): boolean {
  const wanted = host.toLowerCase();
  return (GITHUB_HOSTS as readonly string[]).includes(wanted);
}

/** The raw file host's bare hostname. The GHES seam above widens this too. */
const GITHUB_RAW_HOSTNAME = 'raw.githubusercontent.com';

/** An attachment address on the web host: `/owner/repo/assets/…`. */
const GITHUB_ASSETS_PATH = /^\/[^/]+\/[^/]+\/assets\//;

/**
 * True when a comment body's image address is one a grant reaches: an
 * attachment on the web host, or a raw file on the raw host, both
 * HTTPS-only. `user-images` and avatars are public already and never need
 * the proxy; anything else it must refuse, because the proxy is not a
 * credentialed GET of wherever the markup pointed. The client's `mediaSrc`
 * and the server forge's media gate share this one answer, so the two
 * cannot drift.
 */
export function isGitHubMediaUrl(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  const host = url.host.toLowerCase();
  return (
    host === GITHUB_RAW_HOSTNAME ||
    (isGitHubHost(host) && GITHUB_ASSETS_PATH.test(url.pathname))
  );
}
