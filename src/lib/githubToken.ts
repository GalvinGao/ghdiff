// The permissions ghdiff asks a personal access token for, and the link that
// asks for them.
//
// GitHub's page for a new fine-grained token reads its own form out of the query
// string: `name`, `description`, and `expires_in` fill the fields at the top,
// and one parameter per repository permission ticks the boxes, keyed by
// GitHub's own slug for that permission. So the reviewer lands on a form that
// already asks for the right four, and the only thing left is choosing which
// repositories it covers.
//
// The list stays on screen under the link even so. GitHub ignores a parameter it
// does not recognize and says nothing, so a slug it renamed would leave a box
// unticked in silence, and the list is what the reviewer checks the form
// against. That is also why the list and the link are built from one array
// here: two copies of these four rows would be two chances to disagree.

const TOKEN_PAGE = 'https://github.com/settings/personal-access-tokens/new';

/** What the pre-filled form puts in the name field, to identify it later. */
const TOKEN_NAME = 'ghdiff';

const TOKEN_DESCRIPTION =
  'Read the diffs ghdiff renders, and post review comments as me.';

/** How long the pre-filled form asks the token to live, in days. */
const TOKEN_EXPIRY_DAYS = 90;

export type TokenAccess = 'read' | 'write';

export interface TokenPermission {
  /** The level, which is both the parameter's value and the row's label. */
  access: TokenAccess;
  /** What GitHub's own checkbox is called. */
  name: string;
  /** GitHub's slug for the permission, which is also the parameter name. */
  slug: string;
}

/**
 * Every permission ghdiff asks for, and no more. Metadata is mandatory on any
 * fine-grained token and GitHub grants it without being asked, so it is not
 * listed. Contents reads the diff of a commit or a compare range, Pull requests
 * reads a pull request's diff and writes its comments, and the last two are the
 * check half of the status square, which GraphQL reports as `statusCheckRollup`.
 */
export const TOKEN_PERMISSIONS: readonly TokenPermission[] = [
  { access: 'read', name: 'Contents', slug: 'contents' },
  { access: 'write', name: 'Pull requests', slug: 'pull_requests' },
  { access: 'read', name: 'Commit statuses', slug: 'statuses' },
  { access: 'read', name: 'Checks', slug: 'checks' },
];

/** How each level reads on GitHub's own form. */
export const ACCESS_LABEL: Record<TokenAccess, string> = {
  read: 'Read-only',
  write: 'Read and write',
};

/** GitHub's new-token page, with every permission above already asked for. */
export function fineGrainedTokenUrl(): string {
  const url = new URL(TOKEN_PAGE);
  url.searchParams.set('name', TOKEN_NAME);
  url.searchParams.set('description', TOKEN_DESCRIPTION);
  url.searchParams.set('expires_in', String(TOKEN_EXPIRY_DAYS));
  for (const { access, slug } of TOKEN_PERMISSIONS) {
    url.searchParams.set(slug, access);
  }
  return url.toString();
}
