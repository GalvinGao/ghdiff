// Where a thing on screen lives on a GitLab instance.
//
// The mirror of `../github/urls.ts` for the second forge: every address is built
// here, so a path assembled at one call site cannot drift from the next. The
// host travels with the target, which is what lets one function answer for
// gitlab.com and every self-hosted instance alike.

import type { GitLabProjectRef, GitLabTarget } from '@/lib/reviewTarget';

/** The project's own page. */
export function gitLabProjectUrl({ host, project }: GitLabProjectRef): string {
  return `https://${host}/${project}`;
}

/** The page the review on screen was taken from. */
export function gitLabReviewTargetUrl(target: GitLabTarget): string {
  const root = gitLabProjectUrl(target);
  switch (target.kind) {
    case 'gitlab-mr':
      return `${root}/-/merge_requests/${String(target.number)}`;
    case 'gitlab-commit':
      return `${root}/-/commit/${target.sha}`;
    case 'gitlab-compare':
      return `${root}/-/compare/${target.base}...${target.head}`;
  }
}

/**
 * A permanent link to lines of one file at one commit: `blob`, a full sha
 * rather than a branch, and GitLab's `#L` anchor, which writes a range as
 * `L3-9`. A document the instance renders — markdown and its kin — is asked
 * for its source with `plain=1`, or the anchor lands on nothing.
 */
export function gitLabBlobPermalinkUrl(
  ref: GitLabProjectRef,
  sha: string,
  path: string,
  lines: { start: number; end: number }
): string {
  const start = Math.min(lines.start, lines.end);
  const end = Math.max(lines.start, lines.end);
  const anchor = start === end ? `L${start}` : `L${start}-${end}`;
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  const query = RENDERED_EXTENSIONS.has(extension) ? '?plain=1' : '';
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `${gitLabProjectUrl(ref)}/-/blob/${sha}/${encodedPath}${query}#${anchor}`;
}

/** Files the instance renders as a document rather than as code. */
const RENDERED_EXTENSIONS = new Set([
  'adoc',
  'asciidoc',
  'markdown',
  'md',
  'mdown',
  'mkd',
  'mkdn',
  'org',
  'rst',
]);

/** The scope a ghdiff sign-in asks for: the whole API, for comments and approvals. */
const GITLAB_SCOPE = 'api';

/**
 * Where the instance asks the reviewer to authorize ghdiff's OAuth
 * application. PKCE is here for the same reason it is on the GitHub side: the
 * code travels back through the reviewer's own browser, and the verifier is
 * the half that never leaves this server.
 */
export function gitLabAuthorizeUrl(input: {
  challenge: string;
  clientId: string;
  host: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(`https://${input.host}/oauth/authorize`);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', input.state);
  url.searchParams.set('scope', GITLAB_SCOPE);
  url.searchParams.set('code_challenge', input.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** Where a reviewer creates a personal access token on the instance. */
export function gitLabPatSettingsUrl(host: string): string {
  return `https://${host}/-/user_settings/personal_access_tokens`;
}

/** The project's open merge requests, optionally narrowed to one author. */
export function gitLabMergeRequestsUrl(
  ref: GitLabProjectRef,
  options?: { author?: string }
): string {
  const url = new URL(`https://${ref.host}/${ref.project}/-/merge_requests`);
  url.searchParams.set('state', 'opened');
  if (options?.author != null && options.author.length > 0) {
    url.searchParams.set('author_username', options.author);
  }
  return url.toString();
}
