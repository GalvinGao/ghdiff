// The GitHub hosts a deployment serves. Today exactly one exists —
// github.com. This module is the marked GHES seam: when GitHub Enterprise
// Server support lands the list becomes configured, and every GitHub host
// answer already lives here — the session's grant key and the userscript's
// `@match` list among them.

/** The GitHub hosts this deployment serves, in canonical order. */
export const GITHUB_HOSTS = ['github.com'] as const;
