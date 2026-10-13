// The GitLab REST API as the forge and the reads beside it reach it: the
// version prefix, the headers a credential travels in, the sentence a failure
// carries, and one typed JSON call. The forge's bulk of calls goes through
// gitbeaker; what gitbeaker has no resource for — a merge request's
// reviewers, its deployments by commit, an issue to file — comes through here,
// so both paths speak with the same agent and fail in the same shape.

import { gitHubErrorMessage } from '@/lib/github/error';
import type { ForgeCredential } from '@/lib/server/forges/types';
import { GitHubError, USER_AGENT } from '@/lib/server/github/client';

export const API_VERSION = '/api/v4';

/**
 * The headers one GitLab request is sent with: the app's agent, and the
 * credential the way its kind travels — a personal access token as
 * `PRIVATE-TOKEN`, an OAuth grant as a bearer.
 */
export function gitLabHeaders(cred: ForgeCredential): Record<string, string> {
  const result: Record<string, string> = { 'user-agent': USER_AGENT };
  if (cred.token != null) {
    if (cred.scheme === 'private-token') {
      result['private-token'] = cred.token;
    } else {
      result.authorization = `Bearer ${cred.token}`;
    }
  }
  return result;
}

/** The sentence a GitLab failure carries: `error` when that is the key, else the shared reader's answer. */
export function gitLabErrorMessage(body: string, fallback: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed != null) {
      const error = (parsed as { error?: unknown }).error;
      if (typeof error === 'string' && error.length > 0) return error;
    }
  } catch {
    // Not JSON — the shared reader says the same thing with the body itself.
  }
  return gitHubErrorMessage(body, fallback);
}

/**
 * One JSON call against the instance's REST API, failures in the app's own
 * shape. `path` is below `/api/v4`.
 */
export async function gitLabJson<T>(
  host: string,
  path: string,
  cred: ForgeCredential,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(`https://${host}${API_VERSION}${path}`, {
    method: init.method ?? 'GET',
    cache: 'no-store',
    headers: {
      ...gitLabHeaders(cred),
      ...(init.body == null ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body == null ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) {
    throw new GitHubError(
      response.status,
      gitLabErrorMessage(await response.text(), response.statusText)
    );
  }
  return (await response.json()) as T;
}
