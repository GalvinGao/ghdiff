// Resolving a hostless GitLab path to its canonical address, in the browser.
//
// A bare `/-/` path — `group/repo/-/merge_requests/1` — names a project and a
// page but not the instance, and one deployment may serve several. The splat
// route's answer used to be a document redirect to `/api/resolve`, which could
// never pass through `withRefresh`: a document-level 401 is a text/plain page
// an expired session dead-ends on. So the route renders a resolve marker
// instead, and this module does the resolving: one call to `/api/resolve`
// through `fetchWithRefresh`, the canonical path read out of the 200's
// plain-text body, and a router navigation to it that keeps the fragment the
// address arrived with. Both ways a hostless path arrives — the address bar
// and the home page's box — go through `resolveHostlessPath`, so the two
// entries cannot drift.

import type { NavigateFn } from '@tanstack/react-router';

import { fetchWithRefresh } from '@/lib/authFetch';
import { failureFromHeaders, type FailureMeta } from '@/lib/failure';
import { findGitLabHost, forgeOfHost } from '@/lib/forges';
import {
  headNamesHost,
  type ForgeTarget,
  pathShapeOf,
  reviewTargetFromSegments,
  segmentsFromPath,
  splitColonHost,
  targetFromPathShape,
} from '@/lib/reviewTarget';
import { m } from '@/paraglide/messages.js';

/**
 * What one input to the open-a-review box came to: a target to navigate to,
 * a bare GitLab path the resolve endpoint must find a host for, or nothing
 * this app has an address for.
 */
export type ReviewInput =
  | { kind: 'target'; target: ForgeTarget }
  | { kind: 'hostless'; path: string; hash?: string }
  | { kind: 'none' };

/**
 * Reads whatever the reviewer pasted into the box, in one place so no two
 * entry points can drift: the shorthand (`owner/repo#123`), a forge URL (a
 * github.com address, or a configured GitLab host's `/-/` path, with a
 * trailing tab or a `.diff` suffix still naming the same review), this
 * deployment's own URL (the canonical colon form, or a hostless path with a
 * fragment to carry), the colon form typed bare, and the bare GitLab path,
 * whose host the resolve endpoint finds. A GitLab URL on a host the
 * deployment does not serve is no target — the box says why, naming the
 * configured hosts.
 */
export function reviewInputFrom(
  input: string,
  options: { gitlabHosts: readonly string[]; ownHost?: string }
): ReviewInput {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { kind: 'none' };

  const shorthand = /^([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)#(\d+)$/.exec(
    trimmed
  );
  if (shorthand != null) {
    const path = shorthand[1].split('/');
    // A GitHub repository is exactly owner/repo. A deeper path would nest
    // the way a GitLab project does, but the shorthand names no host and
    // this parser does not guess one.
    if (path.length !== 2) return { kind: 'none' };
    return {
      kind: 'target',
      target: {
        kind: 'github-pull',
        owner: path[0],
        repo: path[1],
        number: Number(shorthand[2]),
      },
    };
  }

  let url: URL | undefined;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    url = undefined;
  }
  if (url != null) {
    const host = url.host.toLowerCase();
    if (options.ownHost != null && host === options.ownHost.toLowerCase()) {
      const target = reviewTargetFromSegments(segmentsFromPath(url.pathname));
      if (target != null) return { kind: 'target', target };
      return hostlessInput(
        url.pathname,
        url.hash.length > 1 ? url.hash.slice(1) : undefined
      );
    }
    // A host the app knows speaks for the URL: GitHub's own (parsed whether
    // or not the deployment serves it — that is the forge gate's question),
    // or a GitLab host the deployment serves. Anything else was probably a
    // bare path, not a URL, and the branches below read it as one.
    const known =
      forgeOfHost(host) === 'github' ||
      findGitLabHost(options.gitlabHosts, host) != null;
    if (known) {
      const path = url.pathname
        .replace(/\/(files|changes|diffs)\/?$/, '/')
        .replace(/\.(diff|patch)(?=\/?$)/, '')
        .replace(/^\/+|\/+$/g, '');
      const shape = pathShapeOf(path);
      if (shape == null) return { kind: 'none' };
      const target = targetFromPathShape(shape, host);
      return target == null ? { kind: 'none' } : { kind: 'target', target };
    }
  }

  const segments = segmentsFromPath(trimmed);
  if (splitColonHost(segments[0] ?? '') != null) {
    const target = reviewTargetFromSegments(segments);
    return target == null ? { kind: 'none' } : { kind: 'target', target };
  }
  return hostlessInput(trimmed, undefined);
}

/**
 * The hostless half of the input: a bare `/-/` path with the fragment split
 * off, or nothing. A colon-glued head is the canonical form and a dotted
 * head with a group and a project behind it is the legacy host form — the
 * route loader's own reading — and what remains must read as GitLab's shape.
 */
function hostlessInput(
  rawPath: string,
  urlHash: string | undefined
): ReviewInput {
  let bare = rawPath;
  let hash = urlHash;
  if (hash == null) {
    const hashIndex = rawPath.indexOf('#');
    if (hashIndex >= 0) {
      bare = rawPath.slice(0, hashIndex);
      const rest = rawPath.slice(hashIndex + 1);
      hash = rest.length > 0 ? rest : undefined;
    }
  }
  const segments = segmentsFromPath(bare);
  if (headNamesHost(segments)) return { kind: 'none' };
  if (pathShapeOf(segments.join('/'))?.forge !== 'gitlab') {
    return { kind: 'none' };
  }
  return {
    kind: 'hostless',
    path: segments.join('/'),
    ...(hash != null ? { hash } : {}),
  };
}

/** What resolving a hostless GitLab path came to. */
export type HostlessResolve =
  | { kind: 'resolved'; splat: string }
  | { kind: 'failed'; failure: FailureMeta | null; message: string };

/** The failure half of `HostlessResolve`, for the faces that show one. */
export type FailedResolve = Extract<HostlessResolve, { kind: 'failed' }>;

/** What a failed resolve says when the answer carried no sentence of its own. */
const UNRESOLVED_MESSAGE =
  m.resolve_that_address_could_not_be_resolved_to_a_gitlab;

/** What the box and the marker say when the resolve call never came back. */
const OFFLINE_MESSAGE = m.resolve_this_ghdiff_could_not_be_reached;

/**
 * The statuses whose answers carry a typed failure. Anything else — a 5xx, a
 * 302 the route no longer answers with — names no reason, and the panel maps
 * nothing.
 */
const FAILURE_STATUSES: readonly number[] = [400, 401, 404];

/**
 * The canonical splat out of a 200's body: one leading slash, stripped, with
 * something left. A body of any other shape is not an address to navigate
 * to — it is the resolve failing, and reads as one.
 */
function canonicalSplatFromBody(body: string): string | undefined {
  const path = body.trim();
  if (!path.startsWith('/')) return undefined;
  const splat = path.slice(1);
  return splat.length > 0 ? splat : undefined;
}

/**
 * The stable reading of one `/api/resolve` answer. A 200 carries the
 * canonical path as its body; 400, 401 and 404 carry the typed failure on
 * the `x-ghdiff-failure` headers and the server's sentence as the body; any
 * other answer names no reason at all. Pure, so the mapping is pinned by
 * test.
 */
export function resolveOutcome(
  status: number,
  headers: Headers,
  body: string
): HostlessResolve {
  if (status === 200) {
    const splat = canonicalSplatFromBody(body);
    return splat != null
      ? { kind: 'resolved', splat }
      : { kind: 'failed', failure: null, message: UNRESOLVED_MESSAGE() };
  }
  const message = body.trim();
  return {
    kind: 'failed',
    failure: FAILURE_STATUSES.includes(status)
      ? failureFromHeaders(headers)
      : null,
    message: message.length > 0 ? message : UNRESOLVED_MESSAGE(),
  };
}

/**
 * Resolves a hostless GitLab path and, on the win, navigates to the canonical
 * address — the fragment the address arrived with carried over, so the file
 * and lines it named survive the host being found. On a failure nothing
 * navigates: the outcome carries the typed reason and the server's own
 * sentence, and the caller puts them on screen. A spent grant is not a
 * failure this function reports — `fetchWithRefresh` has already refreshed it
 * and sent the resolve again by the time an answer arrives.
 */
export async function resolveHostlessPath(options: {
  /** The fragment the address arrived with, `#` stripped. */
  hash?: string;
  navigate: NavigateFn;
  /** The bare `/-/` path, hostless. */
  path: string;
}): Promise<HostlessResolve> {
  const { hash, navigate, path } = options;
  let response: Response;
  try {
    response = await fetchWithRefresh(
      `/api/resolve?path=${encodeURIComponent(path)}`,
      { cache: 'no-store' }
    );
  } catch {
    return { kind: 'failed', failure: null, message: OFFLINE_MESSAGE() };
  }
  const outcome = resolveOutcome(
    response.status,
    response.headers,
    await response.text()
  );
  if (outcome.kind === 'resolved') {
    await navigate({
      to: '/$',
      params: { _splat: outcome.splat },
      ...(hash != null && hash.length > 0 ? { hash } : {}),
    });
  }
  return outcome;
}
