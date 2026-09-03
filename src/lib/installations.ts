// Where the App can actually reach, as the setup page reports it.
//
// A personal access token needed no such idea: it could see whatever its owner
// could see, so there was nothing to explain. A GitHub App reaches only the
// accounts it is installed on, and within an account only the repositories that
// installation covers — so "signed in" and "can read this diff" are two
// different facts, and the second one is the one a 404 is about.
//
// Two shapes of installation, and the difference is what a reviewer has to act
// on. One covers every repository of an account, now and in future, and needs no
// further thought. The other covers a chosen list, and a repository missing from
// that list looks exactly like a repository that does not exist.

export interface AppInstallation {
  id: number;
  /** The user or organization ghdiff is installed on. */
  account: string;
  /** GitHub's own page for changing which repositories it covers. */
  settingsUrl: string;
  /** True when it covers every repository of that account. */
  allRepositories: boolean;
  /**
   * How many repositories the chosen list holds. Absent when the installation
   * covers all of them, where a count would be a figure that goes stale.
   */
  repositoryCount?: number;
}

/**
 * What an installation reaches, in words.
 *
 * Zero is its own answer and not a variant of the plural. An installation that
 * covers a chosen list of nothing is the one state that reads as working from
 * every other angle — it is there, it is listed, the sign-in went through — and
 * still answers 404 for every diff. So it says so.
 */
export function describeInstallationReach(
  installation: AppInstallation
): string {
  if (installation.allRepositories) return 'All repositories';
  const count = installation.repositoryCount ?? 0;
  if (count === 0) return 'No repositories selected';
  return count === 1 ? '1 repository' : `${count} repositories`;
}

/**
 * The installation on one account, if there is one. GitHub compares account
 * names without case, so this does too: an owner typed `Acme` in a URL is the
 * same account as `acme` in an installation.
 */
export function installationForAccount(
  installations: readonly AppInstallation[],
  account: string
): AppInstallation | undefined {
  const wanted = account.toLowerCase();
  return installations.find(
    (installation) => installation.account.toLowerCase() === wanted
  );
}

/**
 * Whether an installation can be expected to reach a diff at all. An account
 * with no installation cannot, and neither can one whose chosen list is empty —
 * and those are two different sentences to put on screen, which is why
 * `installationForAccount` and this are separate questions.
 */
export function reachesAnyRepository(installation: AppInstallation): boolean {
  return (
    installation.allRepositories || (installation.repositoryCount ?? 0) > 0
  );
}
