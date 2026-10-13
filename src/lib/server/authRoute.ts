// What the `/api/auth/*` routes have in common, stated once.
//
// Each of them is a few lines of its own logic wrapped in the same three
// obligations: answer honestly when this deployment has no App, never let a
// cookie or a redirect be cached, and set two `Set-Cookie` lines when there are
// two to set. The last is the one worth a helper — a `Headers` object literal
// with two `set-cookie` keys keeps one of them, and which one it keeps is not
// something to find out in production.

import {
  type DeploymentConfig,
  gitLabHostFor,
  gitLabHostsLabel,
  servesSentence,
} from './config';
import { textResponse } from './plainText';
import { m } from '@/paraglide/messages.js';

/** What a reviewer is told when this deployment has no App behind it. */
export function notConfigured(): Response {
  return textResponse(m.auth_route_this_ghdiff_has_no_github_app_set_up(), {
    status: 501,
  });
}

/**
 * What a GitLab auth route answers on a deployment with no GitLab hosts: not
 * "no App", which would send a reviewer to set one up, but what this instance
 * does serve.
 */
export function notThisGitLab(config: DeploymentConfig): Response {
  return textResponse(
    m.auth_route_no_gitlab_to_connect({ serves: servesSentence(config) }),
    { status: 404 }
  );
}

/**
 * What a GitLab OAuth start answers when it cannot go. The host names one of
 * this deployment's instances but the instance has no OAuth application to
 * send the reviewer to — a personal access token is the way in there. Or the
 * host names no instance this deployment serves, and the sentence says which
 * ones it does.
 */
export function noGitLabOAuth(
  config: DeploymentConfig,
  host: string | undefined
): Response {
  const known = host != null && gitLabHostFor(config, host) != null;
  const message = known
    ? m.auth_route_no_gitlab_oauth_use_a_token()
    : m.auth_route_no_gitlab_oauth_serves_hosts({
        hosts: gitLabHostsLabel(config),
      });
  return textResponse(message, { status: 501 });
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
  // Every one of these answers is about one reviewer, and some carry a
  // credential. Nothing between here and the browser may keep any of it.
  const headers = new Headers({ 'cache-control': 'no-store' });
  for (const cookie of cookies) {
    headers.append('set-cookie', cookie);
  }
  return headers;
}
