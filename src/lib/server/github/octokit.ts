// The GitHub API through octokit, with the app's own rules on every call: the
// user agent workerd would not send, the version header, and every failure in
// the app's own shape. The forge and the GitHub-only reads beside it — the
// deployments, the commits an issue links to — share it, so a request built in
// one cannot differ from one built in the other.

import { Octokit } from '@octokit/core';
import { GraphqlResponseError } from '@octokit/graphql';
import { RequestError } from '@octokit/request-error';

import { gitHubErrorMessageFromData } from '@/lib/github/error';
import { rateLimitedStatus } from '@/lib/rateLimit';
import type { TypedDocumentString } from '@/lib/server/forges/gqlgen/github/graphql';
import type { ForgeCredential } from '@/lib/server/forges/types';
import {
  GITHUB_API_VERSION,
  GitHubError,
  USER_AGENT,
} from '@/lib/server/github/client';
import { m } from '@/paraglide/messages.js';

export function api(cred: ForgeCredential): Octokit {
  const octokit = new Octokit({
    auth: cred.token,
    // workerd sends no User-Agent of its own, and GitHub answers a header-less
    // request with 403. Octokit sends this one on every call.
    userAgent: USER_AGENT,
  });
  // The version header every one of the app's own API calls has always
  // carried, and every failure normalized to the app's own shape — the two
  // jobs the typed route calls below would otherwise wrap each request in.
  // The hook covers GraphQL too, whose call rides the same request chain.
  // The options are amended in place: a wrap that passed a replacement
  // object downstream would have it dropped by the auth hook's merge.
  octokit.hook.wrap('request', async (request, options) => {
    options.headers = { ...options.headers, ...API_HEADERS };
    try {
      return await request(options);
    } catch (error) {
      throw toGitHubError(error);
    }
  });
  return octokit;
}

/** The headers every one of the app's own API calls has always carried. */
const API_HEADERS = { 'x-github-api-version': GITHUB_API_VERSION };

/**
 * Every failure octokit reports becomes the app's own shape: the status a
 * spent quota normalized to 429, and the useful sentence — a validation
 * failure's `errors[].message` rather than the status name.
 */
export function toGitHubError(error: unknown): GitHubError {
  if (error instanceof GitHubError) return error;
  if (error instanceof GraphqlResponseError) {
    const first = error.errors?.[0]?.message;
    return new GitHubError(200, first ?? error.message);
  }
  if (error instanceof RequestError) {
    const headers = new Headers();
    for (const [name, value] of Object.entries(error.response?.headers ?? {})) {
      if (typeof value === 'string') headers.set(name, value);
    }
    const status = rateLimitedStatus(error.status, headers);
    return new GitHubError(
      status,
      gitHubErrorMessageFromData(error.response?.data, error.message)
    );
  }
  return new GitHubError(
    502,
    error instanceof Error
      ? error.message
      : m.diff_that_request_to_github_failed()
  );
}

/** A GraphQL call through octokit, with the app's two extra failure rules. */
export async function gql<TData, TVars extends Record<string, unknown>>(
  octokit: Octokit,
  document: TypedDocumentString<TData, TVars>,
  variables: TVars
): Promise<TData> {
  try {
    // octokit's own types take a bare string, so the document node is unboxed.
    const data = await octokit.graphql<TData>(document.toString(), variables);
    // GraphQL answers 200 with a null `data` for a query it cannot run, and
    // that is a failure here, not an answer.
    if (data == null) {
      throw new GitHubError(
        200,
        m.github_github_returned_no_data_for_that_query()
      );
    }
    return data;
  } catch (error) {
    throw toGitHubError(error);
  }
}
