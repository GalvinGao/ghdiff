// Where a request arrived from outside, stated once: the origin the userscript
// points at, and the scheme a redirect URI is built with.

/**
 * The URL this request arrived on from outside. Behind a TLS-terminating
 * proxy the server hears plain http, so the scheme the browser used comes
 * from the proxy's `X-Forwarded-Proto` — the one header every ingress sets.
 * Only the scheme is taken: the `Host` header is already the one every
 * absolute URL in this app is built from, and `X-Forwarded-Host` is not —
 * a redirect URI is not a thing a forwarded header gets to name.
 */
export function externalRequestUrl(request: Request): string {
  if (request.headers.get('x-forwarded-proto') !== 'https') return request.url;
  const url = new URL(request.url);
  if (url.protocol !== 'http:') return request.url;
  url.protocol = 'https:';
  return url.toString();
}

/**
 * The origin this request arrived on from outside — what a self-hosted
 * deployment's userscript points at, so it opens and updates from the
 * deployment that served it.
 */
export function externalOrigin(request: Request): string {
  return new URL(externalRequestUrl(request)).origin;
}
