import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { useAppData } from '@/components/AppDataProvider';
import { GitLabConnectDialog } from '@/components/GitLabConnectDialog';
import { GitLabMark } from '@/components/GitLabMark';
import {
  InstallationRow,
  InstallationRowSkeleton,
} from '@/components/InstallationRow';
import { AnimatedHeight } from '@/components/ui/AnimatedHeight';
import { Button } from '@/components/ui/Button';
import { buttonClass } from '@/components/ui/buttonClass';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SkeletonBar } from '@/components/ui/SkeletonBar';
import { ViewerIdentity } from '@/components/ViewerIdentity';
import { useCurrentAccount } from '@/hooks/useCurrentPull';
import type { GitHubSessionState } from '@/hooks/useGitHubSession';
import { useInstallations } from '@/hooks/useInstallations';
import type { InstanceInfo } from '@/lib/forges';
import { installationForAccount } from '@/lib/installations';
import { m } from '@/paraglide/messages.js';

/**
 * The accounts, and the accounts ghdiff may read on their behalf.
 *
 * Two facts, not one. Who a reviewer signed in as decides whose name their
 * comments carry; which accounts ghdiff is installed on decides what it can read
 * at all. A GitHub App keeps those apart, so a panel that showed only the first
 * would answer the less useful of the two questions — and the reviewer would
 * have to leave the diff to find out the answer to the other.
 *
 * Shown when there is anything to say: a viewer, a GitLab connection or host,
 * or a deployment whose GitHub sign-in is worth offering. A signed-out
 * reviewer gets a link to `/setup` from the control instead, and a reviewer
 * holding only GitLab connections gets the GitHub sign-in here, beside them.
 *
 * It names no permissions. GitHub's own consent screen names every one the App
 * asks for, it is the only authoritative statement of them, and a list here
 * would be free to drift from the registration it described.
 *
 * The GitHub identity is on screen the moment the panel is, because the session
 * already holds it. Everything under the rule is a request to GitHub, and that
 * region is the one that waits — so it is the one that draws a skeleton and the
 * one whose height travels.
 *
 * The panel is both sections: the GitHub identity and installations, and the
 * GitLab connections. Each stands only when it has something to say — a
 * reviewer with no GitLab hosts configured and no connections never reads the
 * word GitLab here.
 */
export function GitHubAccountPanel({
  active,
  session,
}: {
  /**
   * True when this is actually on screen. The menu it sits in is unmounted while
   * closed, but the home page's dialog keeps its children mounted either way —
   * so without this, asking GitHub which accounts are installed would cost two
   * requests on every visit to the home page, opened or not.
   */
  active: boolean;
  session: GitHubSessionState;
}) {
  const { instance } = useAppData();
  const hosts = instance.gitlab.hosts;
  const showGitHub =
    session.viewer != null || (instance.github.served && instance.github.oauth);
  const showGitLab = session.gitlab.length > 0 || hosts.length > 0;

  if (!showGitHub && !showGitLab) return null;

  return (
    <div className="min-w-0">
      {showGitHub &&
        (session.viewer == null ? (
          <GitHubSignInSection session={session} />
        ) : (
          <GitHubAppSection active={active} session={session} />
        ))}
      {showGitHub && showGitLab && (
        <div className="border-line my-3 border-t" />
      )}
      {showGitLab && <GitLabSection hosts={hosts} session={session} />}

      {/* Only when there is a session to end. A deployment running on
          `GITHUB_TOKEN` has a viewer and nothing to sign out of, and a button
          that did nothing would be a button that lied. A connection made with
          a personal access token still ends here: the cookie drop is its
          sign-out. */}
      {session.canSignOut && (
        <>
          <div className="border-line my-3 border-t" />
          <Button onClick={() => session.signOut()} size="sm" variant="danger">
            {m.git_hub_account_panel_sign_out()}
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * The GitHub section for a reviewer with no GitHub sign-in: the way to make
 * one. Drawn when the deployment serves GitHub and the session holds only
 * GitLab connections, so the door in is where the connections are.
 */
function GitHubSignInSection({ session }: { session: GitHubSessionState }) {
  return (
    <div>
      <SectionLabel className="block">GitHub</SectionLabel>
      <p className="text-ink-muted mt-1.5 text-xs">
        {m.git_hub_account_panel_sign_in_to_open_private_diffs_and_leave()}
      </p>
      <Button
        className="mt-2 w-full justify-center"
        onClick={() => session.signIn()}
        size="sm"
        variant="outline"
      >
        {m.setup_screen_sign_in_with_github()}
      </Button>
    </div>
  );
}

/**
 * The GitLab half of the panel: the connections this session holds, and the
 * way to make one. There is no second list to wait for — GitLab has no
 * installation object the way the App does — so the whole section is on screen
 * with the session, and nothing in it travels.
 */
function GitLabSection({
  hosts,
  session,
}: {
  hosts: InstanceInfo['gitlab']['hosts'];
  session: GitHubSessionState;
}) {
  const [connecting, setConnecting] = useState(false);

  return (
    <div>
      <SectionLabel className="block">GitLab</SectionLabel>
      {session.gitlab.length > 0 ? (
        <div className="mt-1.5 flex flex-col gap-2.5">
          {session.gitlab.map((connection) => (
            <div key={connection.host}>
              <div className="flex items-center justify-between gap-2">
                <ViewerIdentity viewer={connection.viewer} />
                <Button
                  onClick={() => session.disconnectGitLab(connection.host)}
                  size="sm"
                  variant="outline"
                >
                  {m.git_hub_account_panel_disconnect()}
                </Button>
              </div>
              <p className="text-ink-faint mt-1 flex items-center gap-1.5 font-mono text-xs">
                <GitLabMark aria-hidden="true" size={12} />
                {connection.host}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-ink-muted mt-1.5 text-xs">
          {m.git_hub_account_panel_no_gitlab_account_connected_yet()}
        </p>
      )}
      <p className="text-ink-faint mt-2 text-xs">
        {m.git_hub_account_panel_comments_on_a_gitlab_diff_post()}
      </p>
      {hosts.length > 0 && (
        <Button
          className="mt-2 w-full justify-center"
          onClick={() => setConnecting(true)}
          size="sm"
          variant="outline"
        >
          {m.gitlab_connect_connect_gitlab()}
        </Button>
      )}
      <GitLabConnectDialog
        onClose={() => setConnecting(false)}
        open={connecting}
      />
    </div>
  );
}

/** The GitHub App section, as it always was. */
function GitHubAppSection({
  active,
  session,
}: {
  active: boolean;
  session: GitHubSessionState;
}) {
  const viewer = session.viewer;
  const apps = useInstallations({ ready: active && viewer != null });
  // Read off the path, the way the left bar reads the pull request it marks.
  // Nothing has to hand it down, and it is right over a review, the home page
  // and a 404 alike.
  const account = useCurrentAccount();
  const wanted =
    account == null
      ? undefined
      : installationForAccount(apps.installations, account);

  if (viewer == null) return null;

  return (
    <div className="min-w-0">
      <SectionLabel className="block">GitHub</SectionLabel>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <ViewerIdentity viewer={viewer} />
        {session.canDisconnectGitHub && (
          <Button
            onClick={() => session.disconnectGitHub()}
            size="sm"
            variant="outline"
          >
            {m.git_hub_account_panel_disconnect()}
          </Button>
        )}
      </div>
      <p className="text-ink-faint mt-2 text-xs">
        {m.git_hub_account_panel_comments_you_leave_go_to_github_under_this()}
      </p>

      <div className="border-line my-3 border-t" />

      {/* The wait and the answer are rarely the same height — a reviewer
          installed on one account, or on five, or on none — so the box between
          them travels rather than snapping the panel to a new size. A reviewer
          installed on three pays nothing for it: the guess below is right, the
          height does not change, and no transition runs. */}
      <AnimatedHeight>
        {apps.error != null ? (
          <p className="text-removed text-xs">{apps.error}</p>
        ) : !apps.answered ? (
          <InstallationsSkeleton />
        ) : apps.installations.length > 0 ? (
          <>
            <AccessHeading />
            {/* Bare rows, not cards. This is about 296px wide in the header, and
                a card apiece would spend most of it on borders. */}
            <div className="mt-1.5 flex flex-col">
              {apps.installations.map((installation) => (
                <InstallationRow
                  key={installation.id}
                  className="py-1.5"
                  installation={installation}
                  wanted={installation === wanted}
                />
              ))}
            </div>
            {apps.installUrl != null && (
              <a
                className={buttonClass({
                  className: 'mt-1 w-full justify-center',
                  size: 'sm',
                  variant: 'outline',
                })}
                href={apps.installUrl}
                rel="noreferrer"
                target="_blank"
              >
                {m.git_hub_account_panel_install_on_another_account()}
              </a>
            )}
          </>
        ) : (
          <>
            {/* Installed nowhere, which is a reviewer who can read no private
                code at all. The whole of step two is a page away rather than
                repeated in a menu, so this points at it. */}
            <p className="text-ink-muted text-xs">
              {m.git_hub_account_panel_ghdiff_isn_t_installed_on_any_account_set()}
            </p>
            <Link
              className={buttonClass({
                className: 'mt-2 w-full justify-center',
                size: 'sm',
                variant: 'outline',
              })}
              search={{
                account: undefined,
                from: undefined,
                migrated: undefined,
              }}
              to="/setup"
            >
              {m.git_hub_account_panel_open_setup_guide()}
            </Link>
          </>
        )}
      </AnimatedHeight>
    </div>
  );
}

/**
 * The two lines above the list, which are the same two lines whether GitHub has
 * answered or not.
 *
 * Static copy, so the skeleton prints it rather than a bar in its place: there
 * is nothing to wait for, and a heading that fades in is a heading that moves
 * the rows under it.
 */
function AccessHeading() {
  return (
    <>
      <SectionLabel className="block">
        {m.git_hub_account_panel_accounts_with_access()}
      </SectionLabel>
      <p className="text-ink-faint mt-0.5 text-xs">
        {m.git_hub_account_panel_opens_settings_on_github_com_to_add_or()}
      </p>
    </>
  );
}

// The shape of the answer, before the answer.
//
// Three rows, because three is the shape this panel most often takes: a
// reviewer reading it is signed in, so their own account is installed, and the
// organizations they review for are the rest. Guessing three costs a reviewer
// installed on three nothing at all — the region is already the height it needs
// and no transition runs — and costs everybody else one 200ms travel.
//
// The widths differ per row so that three placeholders read as three accounts
// rather than as a table, and each is a plausible length: an account name is
// short, and the reach under it is a phrase.
const SKELETON_ROWS: readonly { name: string; reach: string }[] = [
  { name: 'w-20', reach: 'w-24' },
  { name: 'w-28', reach: 'w-20' },
  { name: 'w-16', reach: 'w-28' },
];

function InstallationsSkeleton() {
  return (
    <div className="animate-pulse motion-reduce:animate-none" role="status">
      <span className="sr-only">
        {m.git_hub_account_panel_checking_which_github_accounts_ghdiff_can_read()}
      </span>
      <AccessHeading />
      <div aria-hidden="true" className="mt-1.5 flex flex-col">
        {SKELETON_ROWS.map((widths, index) => (
          <InstallationRowSkeleton
            key={index}
            className="py-1.5"
            nameWidth={widths.name}
            reachWidth={widths.reach}
          />
        ))}
      </div>
      {/* The install control is reserved too. Its address arrives with the same
          answer, and a deployment that offers a sign-in has an App to install —
          so the row it will need is a row it will get. */}
      <SkeletonBar className="mt-1 h-7 w-full rounded-md" />
    </div>
  );
}
