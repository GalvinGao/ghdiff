// The typed reason a call failed, carried beside the human sentence so the
// client can act on the failure without parsing prose. A status alone cannot
// say which failures the reviewer can act on: GitHub answers 404 for a missing
// diff and an invisible one alike, and a GitLab 401 is the instance asking for
// an account only when the caller is anonymous — a connected grant that died
// is a different failure with a different fix.
//
// The plain routes carry the reason on the `x-ghdiff-failure` response header
// (with `x-ghdiff-forge` / `x-ghdiff-host` beside it when known); the RPC
// router carries the same shape in the error's structured `data`. This module
// is client-safe: both sides import it, and it imports nothing.

import { m } from '@/paraglide/messages.js';

/** Why a call failed, as one of a handful of readings the panel acts on. */
export type FailureReason =
  | 'not-served'
  | 'auth-required'
  | 'auth-expired'
  | 'permission-denied'
  | 'not-found'
  | 'bad-request'
  | 'rate-limited';

export interface FailureMeta {
  reason: FailureReason;
  forge?: 'github' | 'gitlab';
  host?: string;
}

const REASONS: readonly FailureReason[] = [
  'not-served',
  'auth-required',
  'auth-expired',
  'permission-denied',
  'not-found',
  'bad-request',
  'rate-limited',
];

/** Whether a value is a `FailureMeta` — the wire shape is not trusted. */
export function isFailureMeta(value: unknown): value is FailureMeta {
  if (typeof value !== 'object' || value === null) return false;
  const reason = (value as { reason?: unknown }).reason;
  return (
    typeof reason === 'string' &&
    (REASONS as readonly string[]).includes(reason)
  );
}

/** The header a plain route's failure answer names its reason on. */
export const FAILURE_HEADER = 'x-ghdiff-failure';
/** The forge the failure is against, when the answer knows it. */
export const FAILURE_FORGE_HEADER = 'x-ghdiff-forge';
/** The GitLab host the failure is against, when the answer knows it. */
export const FAILURE_HOST_HEADER = 'x-ghdiff-host';

/**
 * The failure a plain route's answer carries, read off its headers. Absent —
 * not guessed from the status — when the answer names no reason.
 */
export function failureFromHeaders(headers: Headers): FailureMeta | null {
  const reason = headers.get(FAILURE_HEADER);
  if (reason == null || !(REASONS as readonly string[]).includes(reason)) {
    return null;
  }
  const forge = headers.get(FAILURE_FORGE_HEADER);
  const host = headers.get(FAILURE_HOST_HEADER);
  return {
    reason: reason as FailureReason,
    ...(forge === 'github' || forge === 'gitlab' ? { forge } : {}),
    ...(host != null ? { host } : {}),
  };
}

/**
 * The failure a forge's HTTP status reads as, for the routes and the RPC
 * router that only have the status. The 401 reading turns on whether a
 * credential spoke: an anonymous refusal is `auth-required`, a credential the
 * forge will not take is spent or revoked and is `auth-expired`. Statuses with
 * no reading here — a 5xx, a 413 — answer no failure at all.
 */
export function failureForStatus(
  status: number,
  meta: { forge?: 'github' | 'gitlab'; host?: string; credentialed: boolean }
): FailureMeta | undefined {
  let reason: FailureReason;
  switch (status) {
    case 400:
    case 422:
      reason = 'bad-request';
      break;
    case 401:
      reason = meta.credentialed ? 'auth-expired' : 'auth-required';
      break;
    case 403:
      reason = 'permission-denied';
      break;
    case 404:
      reason = 'not-found';
      break;
    case 429:
      reason = 'rate-limited';
      break;
    default:
      return undefined;
  }
  return {
    reason,
    ...(meta.forge != null ? { forge: meta.forge } : {}),
    ...(meta.host != null ? { host: meta.host } : {}),
  };
}

/**
 * The sentence a spent grant answers with. Forge-appropriate where the target
 * names the forge; a gate that cannot know which grant died — the RPC edge, or
 * `/api/resolve` — says so without naming one.
 */
export function authExpiredMessage(
  forge?: 'github' | 'gitlab',
  host?: string
): string {
  if (forge === 'gitlab') {
    return host == null
      ? m.failure_your_connection_to_this_gitlab_instance_is_no_longer_valid()
      : m.failure_your_connection_to_host_is_no_longer_valid({ host });
  }
  if (forge === 'github') {
    return m.github_your_github_sign_in_is_no_longer_valid();
  }
  return m.failure_your_sign_in_is_no_longer_valid();
}
