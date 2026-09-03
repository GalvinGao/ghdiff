// What the four `/api/auth/*` routes have in common, stated once.
//
// Each of them is a few lines of its own logic wrapped in the same three
// obligations: answer honestly when this deployment has no App, never let a
// cookie or a redirect be cached, and set two `Set-Cookie` lines when there are
// two to set. The last is the one worth a helper — a `Headers` object literal
// with two `set-cookie` keys keeps one of them, and which one it keeps is not
// something to find out in production.

import { readAppConfig, type AppConfig } from './githubApp.ts';
import { readKeyring } from './session.ts';

/** Everything a route needs before it can speak for the App. */
export interface AuthSetup {
  config: AppConfig;
  keyring: readonly string[];
}

/**
 * The App and the keyring, or nothing. Nothing is a deployment that never set
 * them, which is a deployment that serves public diffs and cannot sign anybody
 * in — so these routes say so plainly rather than fail as though something broke.
 */
export function readAuthSetup(): AuthSetup | undefined {
  const config = readAppConfig();
  const keyring = readKeyring();
  if (config == null || keyring == null) return undefined;
  return { config, keyring };
}

/** What a reviewer is told when this deployment has no App behind it. */
export function notConfigured(): Response {
  return new Response(
    'This ghdiff has no GitHub App set up, so it cannot sign you in.',
    {
      status: 501,
      headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' },
    }
  );
}

/**
 * A response with no body, and however many cookies the caller has. `Headers`
 * is built and appended to rather than handed an object, because two cookies in
 * one object literal are one cookie by the time the browser sees it.
 */
export function empty(
  status: number,
  cookies: readonly string[] = []
): Response {
  return new Response(null, { status, headers: cookieHeaders(cookies) });
}

/** A redirect, with however many cookies the caller has. */
export function redirectTo(
  location: string,
  cookies: readonly string[] = []
): Response {
  const headers = cookieHeaders(cookies);
  headers.set('location', location);
  return new Response(null, { status: 302, headers });
}

function cookieHeaders(cookies: readonly string[]): Headers {
  // Every one of these answers is about one reviewer, and two of the four carry
  // a credential. Nothing between here and the browser may keep any of it.
  const headers = new Headers({ 'cache-control': 'no-store' });
  for (const cookie of cookies) {
    headers.append('set-cookie', cookie);
  }
  return headers;
}
