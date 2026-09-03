import { IconArrowUpRight, IconBrandGithub, IconRefresh } from '@pierre/icons';
import { Link } from '@tanstack/react-router';

import { useAppData } from '@/components/AppDataProvider';
import { ColorModeToggle } from '@/components/ColorModeToggle';
import { InstallationRow } from '@/components/InstallationRow';
import { Button } from '@/components/ui/Button';
import { buttonClass } from '@/components/ui/buttonClass';
import { SectionLabel } from '@/components/ui/SectionLabel';
import {
  Step,
  StepNote,
  StepRail,
  type StepStatus,
} from '@/components/ui/StepRail';
import { ViewerAvatar, viewerDisplayName } from '@/components/ViewerIdentity';
import { useInstallations } from '@/hooks/useInstallations';
import { personalAccessTokensUrl } from '@/lib/githubUrls';
import {
  installationForAccount,
  reachesAnyRepository,
} from '@/lib/installations';
import { gitHubTargetFromSegments } from '@/lib/reviewTarget';
import { safeReturnTo } from '@/lib/session';

// Why a private diff will not load, as three things to do in order.
//
// The panel that sends a reviewer here can say one sentence and offer one
// button. What it cannot do is answer the question behind the sentence, which is
// not "what went wrong" but "what is still missing" — and under a GitHub App
// there are two separate things that can be, in a fixed order. Signed in with no
// installation reads exactly like signed out. An installation on the wrong
// account reads exactly like no installation. A page that checks each in turn and
// says which one is not done yet is the difference between a fix and a guess.
//
// Each step reports its own state from what GitHub actually answered, never from
// what the reviewer was told to do. So a step is done because it is done, and the
// rail cannot claim progress the App does not have.

/** The card every step's own content sits on. Matches the home page's. */
const CARD = 'border-line bg-raised rounded-xl border px-4 py-3 shadow-sm';

/**
 * Which account a diff belongs to, out of the path the reviewer came from. The
 * parse is `gitHubTargetFromSegments`, the same one the review route itself uses,
 * so a path this page reads an owner out of is a path that route would have
 * rendered — there is no second idea here of what a review URL looks like.
 */
function accountFromPath(path: string | undefined): string | undefined {
  if (path == null) return undefined;
  const target = gitHubTargetFromSegments(path.replace(/^\//, '').split('/'));
  return target?.owner;
}

export function SetupScreen({
  account: named,
  from,
  migrated,
}: {
  /** The account the caller already knows about, when it knows one. */
  account?: string;
  from?: string;
  /**
   * Set by the one redirect `useGitHubSession` makes, when it found a personal
   * access token this browser was still holding from before the GitHub App. It
   * changes what this page says and nothing about what it does.
   */
  migrated?: true;
}) {
  const { colorMode, session } = useAppData();
  // Only once GitHub has answered for the credential. Asking where the App is
  // installed before then would spend a request to be told "nobody", which is
  // the answer step one is about to change.
  const apps = useInstallations({ ready: !session.checking });

  const returnTo = from == null ? undefined : safeReturnTo(from);
  // A caller that named the account wins, since it knew; otherwise read it out
  // of the path, which is the review panel's way of naming the same thing.
  const account = named ?? accountFromPath(returnTo);

  // Step two is done when the App can reach something. Which "something" depends
  // on what is known: a reviewer who came from a diff is asking about that one
  // account, and an installation somewhere else does nothing for them. A reviewer
  // who came here on their own is asking the general question.
  const wanted =
    account == null
      ? undefined
      : installationForAccount(apps.installations, account);
  const reaching = apps.installations.filter(reachesAnyRepository);
  const installed =
    account == null
      ? reaching.length > 0
      : wanted != null && reachesAnyRepository(wanted);

  const signedIn = session.signedIn;
  // The first step not done is the current one, so an earlier gap is never
  // skipped past. Step three is never `done`: opening the diff is the thing this
  // page hands back, and it has no way to learn whether it worked.
  const done = [signedIn, signedIn && installed, false];
  const firstUndone = done.findIndex((value) => value !== true);
  const [signIn, install, open] = done.map<StepStatus>((isDone, index) =>
    isDone ? 'done' : index === firstUndone ? 'current' : 'upcoming'
  ) as [StepStatus, StepStatus, StepStatus];

  return (
    <main className="bg-surface flex min-h-0 flex-1 overflow-y-auto overscroll-none">
      <ColorModeToggle
        className="fixed top-3 right-3 z-10"
        colorMode={colorMode}
      />

      <div className="m-auto w-full max-w-2xl px-6 py-14">
        {/* The way home. This page is reachable with the left bar hidden, and no
            screen in this app is a dead end. */}
        <Link className="text-ink-faint hover:text-ink text-xs" to="/">
          ghdiff.com
        </Link>
        {migrated === true && <MigrationNotice />}
        <h1 className="text-ink mt-3 text-2xl font-semibold tracking-tight">
          Set up private repository access
        </h1>
        <p className="text-ink-muted mt-2 text-sm">
          GitHub only lets ghdiff read repositories you grant it access to.
          Complete these three steps in order.
        </p>

        <div className="mt-8">
          <StepRail>
            <Step label="Sign in to GitHub" number={1} status={signIn}>
              {session.viewer != null ? (
                <div className={`${CARD} flex items-center gap-2.5`}>
                  <ViewerAvatar size={22} viewer={session.viewer} />
                  <span className="text-ink min-w-0 truncate text-sm">
                    {viewerDisplayName(session.viewer)}
                  </span>
                </div>
              ) : (
                <>
                  <p className="text-ink-muted text-sm">
                    This identifies your account to GitHub. Any comments you
                    leave will post under this account.
                  </p>
                  <Button
                    className="mt-2 self-start"
                    onClick={() => session.signIn()}
                    variant="solid"
                  >
                    <IconBrandGithub aria-hidden="true" size={14} />
                    Sign in with GitHub
                  </Button>
                </>
              )}
            </Step>

            <Step label="Grant repository access" number={2} status={install}>
              <p className="text-ink-muted text-sm">
                {account == null
                  ? 'Signing in only identifies you. Choose the accounts and repositories ghdiff can read.'
                  : `Signing in only identifies you. Install ghdiff on ${account} and ensure this repository is included in its access list.`}
              </p>

              {apps.error != null && (
                <p className="text-removed mt-2 text-sm">{apps.error}</p>
              )}

              {apps.installations.length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <SectionLabel>Accounts with access</SectionLabel>
                  {apps.installations.map((installation) => (
                    <InstallationRow
                      key={installation.id}
                      className={CARD}
                      installation={installation}
                      wanted={account != null && installation === wanted}
                    />
                  ))}
                </div>
              )}

              {apps.installUrl != null && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {/* A new tab, and a plain anchor. Installing happens on
                      github.com and takes a few presses, and this page has to
                      still be here to come back to — it is the page that says
                      whether it worked. */}
                  <a
                    // Filled only on the step that is actually next. Two
                    // filled controls on one screen is the one thing this
                    // app's accent rule forbids, and step one's sign-in is
                    // the other.
                    className={buttonClass({
                      variant: install === 'current' ? 'solid' : 'outline',
                    })}
                    href={apps.installUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {apps.installations.length === 0
                      ? 'Install ghdiff'
                      : 'Install on another account'}
                    <IconArrowUpRight aria-hidden="true" size={13} />
                  </a>
                  {/* Nothing polls for the answer. A reviewer comes back from the
                      other tab knowing they have finished, and this is how they
                      say so. */}
                  <Button
                    disabled={apps.loading}
                    onClick={apps.reload}
                    variant="outline"
                  >
                    <IconRefresh aria-hidden="true" size={13} />
                    {apps.loading ? 'Checking…' : 'Check again'}
                  </Button>
                </div>
              )}

              {account != null && wanted == null && !apps.loading && (
                <StepNote>
                  ghdiff is not installed on <strong>{account}</strong> yet. If
                  this is an organization, an owner may need to approve the
                  installation.
                </StepNote>
              )}
              {wanted != null && !reachesAnyRepository(wanted) && (
                <StepNote>
                  ghdiff is installed on <strong>{account}</strong>, but covers
                  no repositories yet. Open its settings to select the
                  repositories you review.
                </StepNote>
              )}
            </Step>

            <Step label="Open the diff" last number={3} status={open}>
              <p className="text-ink-muted text-sm">
                {returnTo == null || returnTo === '/'
                  ? 'Go to the home page to paste a pull request, commit, or compare URL.'
                  : 'Return to your diff. ghdiff will fetch it again using your updated permissions.'}
              </p>
              {/* A plain anchor and a whole page load, not a client navigation:
                  the point of coming back is a fresh request to GitHub under the
                  installation that did not exist a minute ago. */}
              <a
                className={buttonClass({
                  className: 'mt-2 self-start',
                  variant: open === 'current' ? 'solid' : 'outline',
                })}
                href={returnTo == null || returnTo === '/' ? '/' : returnTo}
              >
                {returnTo == null || returnTo === '/'
                  ? 'Go to ghdiff home'
                  : 'Return to the diff'}
              </a>
            </Step>
          </StepRail>
        </div>

        {apps.installUrl == null && !session.checking && (
          <p className="text-ink-faint mt-8 text-xs">
            This ghdiff deployment has no GitHub App set up. You can still view
            any public diff.
          </p>
        )}
      </div>
    </main>
  );
}

/**
 * What happened to the token this browser used to hold.
 *
 * A notice on the page rather than a dialog over it. This page exists to explain
 * exactly this, so a modal would have to be dismissed before any of it could be
 * read — and the link in here is a thing to act on, which a dismissed modal
 * takes away. On the page it stays reachable while the three steps are worked
 * through.
 *
 * It says GitHub still accepts the token, and it says so on purpose. Removing
 * it from storage revokes nothing: it is live at GitHub until the reviewer
 * deletes it, for whatever is left of the ninety days the old form asked for.
 * Wording that called it cleared, revoked or safe would read as "the credential
 * is dead", and a reviewer who believed that would leave it valid for months.
 * "GitHub still accepts that token" names the actor, which is what shuts that
 * reading down.
 */
function MigrationNotice() {
  return (
    <div
      className="border-line bg-raised mt-3 mb-6 rounded-xl border px-4 py-3 shadow-sm"
      role="status"
    >
      <p className="text-ink text-sm font-medium">
        ghdiff now uses a GitHub App
      </p>
      <p className="text-ink-muted mt-1 text-sm text-pretty">
        ghdiff removed your old personal access token from this browser and no
        longer asks for one. GitHub still accepts that token until you delete it
        in your GitHub settings.
      </p>
      <a
        className={buttonClass({
          className: 'mt-2.5',
          size: 'sm',
          variant: 'outline',
        })}
        href={personalAccessTokensUrl()}
        rel="noreferrer"
        target="_blank"
      >
        Delete the token on GitHub
        <IconArrowUpRight aria-hidden="true" size={12} />
      </a>
    </div>
  );
}
