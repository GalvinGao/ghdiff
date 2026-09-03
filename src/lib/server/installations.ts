// What the setup page asks GitHub: where is this App installed, and how far does
// each installation reach.
//
// `GET /user/installations` is a user-to-server endpoint — it answers for the
// token's own user and the App the token belongs to, which is exactly the
// question, and it needs no App-level JWT to ask it.
//
// The reach costs a second request, and only for an installation that covers a
// chosen list: one that covers all of them has no figure worth fetching. The
// second call asks for one repository per page and reads `total_count` off the
// answer, so a reviewer with an installation over three hundred repositories
// pays for one of them.

import type { AppInstallation } from '../installations.ts';
import { githubJson } from './github.ts';

/**
 * How many installations get their reach counted. A reviewer with more accounts
 * than this is somebody the setup page has already answered for — the point of
 * the figure is to catch an empty chosen list, and it is drawn from the first few
 * rather than paying a request each for a long tail.
 */
const MAX_COUNTED = 10;

interface GitHubInstallation {
  id: number;
  account?: { login?: string } | null;
  /** GitHub's own settings page for this installation. */
  html_url?: string;
  /** 'all' or 'selected'. */
  repository_selection?: string;
}

/** Where this token's own user has ghdiff installed, most recent first. */
export async function readInstallations(
  token: string
): Promise<AppInstallation[]> {
  const answer = await githubJson<{ installations?: GitHubInstallation[] }>(
    '/user/installations?per_page=100',
    token
  );

  const installations = (answer.installations ?? []).map(
    (raw): AppInstallation => ({
      id: raw.id,
      // An installation with no account is not a thing GitHub returns, but the
      // field is optional in its own schema and a blank row on the setup page
      // would be worse than an honest placeholder.
      account: raw.account?.login ?? 'an account',
      // GitHub's own URL rather than one built here. A personal installation and
      // an organization's live under different paths, and GitHub is the only
      // authority on which of the two this is.
      settingsUrl: raw.html_url ?? 'https://github.com/settings/installations',
      allRepositories: raw.repository_selection === 'all',
    })
  );

  await Promise.all(
    installations
      .filter((installation) => !installation.allRepositories)
      .slice(0, MAX_COUNTED)
      .map(async (installation) => {
        installation.repositoryCount = await countRepositories(
          installation.id,
          token
        );
      })
  );

  return installations;
}

/**
 * How many repositories one installation covers. A failure answers with nothing
 * rather than throwing: the count is what turns "installed" into "installed on
 * three repositories", and a setup page that showed neither because one figure
 * would not load would be a worse page than one that shows the row.
 */
async function countRepositories(
  installationId: number,
  token: string
): Promise<number | undefined> {
  try {
    const answer = await githubJson<{ total_count?: number }>(
      `/user/installations/${installationId}/repositories?per_page=1`,
      token
    );
    return typeof answer.total_count === 'number'
      ? answer.total_count
      : undefined;
  } catch {
    return undefined;
  }
}
