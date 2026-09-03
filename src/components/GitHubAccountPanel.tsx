import { Link } from '@tanstack/react-router';

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
import { type GitHubSessionState } from '@/hooks/useGitHubSession';
import { useInstallations } from '@/hooks/useInstallations';
import { installationForAccount } from '@/lib/installations';

/**
 * The account, and the accounts ghdiff may read on its behalf.
 *
 * Two facts, not one. Who a reviewer signed in as decides whose name their
 * comments carry; which accounts ghdiff is installed on decides what it can read
 * at all. A GitHub App keeps those apart, so a panel that showed only the first
 * would answer the less useful of the two questions — and the reviewer would
 * have to leave the diff to find out the answer to the other.
 *
 * Only ever shown to somebody already signed in. Both entries to it are drawn
 * from the viewer, and a signed-out reviewer gets a link to `/setup` instead.
 *
 * It names no permissions. GitHub's own consent screen names every one the App
 * asks for, it is the only authoritative statement of them, and a list here
 * would be free to drift from the registration it described.
 *
 * The identity at the top is on screen the moment the panel is, because the
 * session already holds it. Everything under the rule is a request to GitHub,
 * and that region is the one that waits — so it is the one that draws a skeleton
 * and the one whose height travels.
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
      <ViewerIdentity viewer={viewer} />
      <p className="text-ink-faint mt-2 text-xs">
        Comments you leave go to GitHub under this account.
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
                Install on another account
              </a>
            )}
          </>
        ) : (
          <>
            {/* Installed nowhere, which is a reviewer who can read no private
                code at all. The whole of step two is a page away rather than
                repeated in a menu, so this points at it. */}
            <p className="text-ink-muted text-xs">
              ghdiff isn't installed on any account. Set it up to read your
              code.
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
              Open setup guide
            </Link>
          </>
        )}
      </AnimatedHeight>

      {/* Only when there is a session to end. A deployment running on
          `GITHUB_TOKEN` has a viewer and nothing to sign out of, and a button
          that did nothing would be a button that lied. */}
      {session.canSignOut && (
        <>
          <div className="border-line my-3 border-t" />
          <Button onClick={() => session.signOut()} size="sm" variant="danger">
            Sign out
          </Button>
        </>
      )}
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
      <SectionLabel className="block">Accounts with access</SectionLabel>
      <p className="text-ink-faint mt-0.5 text-xs">
        Opens settings on github.com to add or remove repositories.
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
        Checking which GitHub accounts ghdiff can read…
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
