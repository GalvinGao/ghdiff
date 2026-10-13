import { ParaglideMessage } from '@inlang/paraglide-js-react';
import { IconArrowUpRight, IconBrandGithub, IconRefresh } from '@pierre/icons';
import { Link, useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { useAppData } from '@/components/AppDataProvider';
import { ColorModeToggle } from '@/components/ColorModeToggle';
import { GitLabMark } from '@/components/GitLabMark';
import { GitLabPatForm } from '@/components/GitLabPatForm';
import {
  InstallationRow,
  InstallationRowSkeleton,
} from '@/components/InstallationRow';
import { LanguageMenu } from '@/components/LanguageMenu';
import { AnimatedHeight } from '@/components/ui/AnimatedHeight';
import { Button } from '@/components/ui/Button';
import { buttonClass } from '@/components/ui/buttonClass';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SkeletonBar } from '@/components/ui/SkeletonBar';
import {
  Step,
  StepNote,
  StepRail,
  type StepStatus,
} from '@/components/ui/StepRail';
import { ViewerAvatar, viewerDisplayName } from '@/components/ViewerIdentity';
import { gitLabConnectionFor } from '@/hooks/useGitHubSession';
import { useGitLabOAuth } from '@/hooks/useGitLabOAuth';
import { useInstallations } from '@/hooks/useInstallations';
import { type InstanceInfo, isGitLabTarget } from '@/lib/forges';
import { personalAccessTokensUrl } from '@/lib/github/urls';
import {
  installationForAccount,
  reachesAnyRepository,
} from '@/lib/installations';
import { reviewTargetFromSegments, segmentsFromPath } from '@/lib/reviewTarget';
import { gitLabAuthStartUrl, safeReturnTo } from '@/lib/session';
import type { GitHubViewer } from '@/lib/viewer';
import { m } from '@/paraglide/messages.js';

const setupMarkup = {
  strong: ({ children }: { children?: ReactNode }) => (
    <strong>{children}</strong>
  ),
};

// Why a private diff will not load, as things to do in order.
//
// The panel that sends a reviewer here can say one sentence and offer one
// button. What it cannot do is answer the question behind the sentence, which is
// not "what went wrong" but "what is still missing" — and under a GitHub App
// there are two separate things that can be, in a fixed order. Signed in with no
// installation reads exactly like signed out. An installation on the wrong
// account reads exactly like no installation. A page that checks each in turn and
// says which one is not done yet is the difference between a fix and a guess.
//
// Each step reports its own state from what the forge actually answered, never
// from what the reviewer was told to do. So a step is done because it is done,
// and the rail cannot claim progress the forge does not have.
//
// The page is one page on every deployment: the three GitHub steps, then a
// GitLab section per configured host — connect, then open the diff. A
// connection needs no installation step, because it reads whatever the account
// behind it can see. Which section leads is the `from` path's: a reviewer sent
// here from a GitLab diff finds that host's connect waiting filled.

/** The card every step's own content sits on. Matches the home page's. */
const CARD = 'border-line bg-raised rounded-xl border px-4 py-3 shadow-sm';

/**
 * Which account a diff belongs to, out of the path the reviewer came from. The
 * parse is `reviewTargetFromSegments`, the same one the review route itself
 * uses, so a path this page reads an owner out of is a path that route would
 * have rendered — there is no second idea here of what a review URL looks
 * like. The answer is the forge's own notion of an account: the owner on
 * GitHub, where the steps below name an installation; the project's full path
 * on GitLab, where they name what the connection must reach.
 */
function accountFromPath(path: string | undefined): string | undefined {
  if (path == null) return undefined;
  const target = reviewTargetFromSegments(segmentsFromPath(path));
  if (target == null) return undefined;
  return isGitLabTarget(target) ? target.project : target.owner;
}

/**
 * The host a GitLab `from` path belongs to, when it is a GitLab one: the
 * section below fills that host's connect, and its open step waits on that
 * host's connection.
 */
function gitLabHostFromPath(path: string | undefined): string | undefined {
  if (path == null) return undefined;
  const target = reviewTargetFromSegments(segmentsFromPath(path));
  return target != null && isGitLabTarget(target) ? target.host : undefined;
}

/**
 * The rail's reading of the steps. The first step not done is the current one,
 * so an earlier gap is never skipped past — a sign-in without an installation
 * still asks for the installation, not for the diff. And a step that waits on
 * an unanswered question is `upcoming` with everything after it, so the rail
 * never lights a step on a guess — a pulse on **Sign in** before the forge has
 * said whether the reviewer already is one is that guess.
 */
function stepStatuses(
  done: readonly boolean[],
  known: readonly boolean[] = []
): StepStatus[] {
  const firstUnknown = known.indexOf(false);
  const firstUndone = done.findIndex((value) => value !== true);
  return done.map((isDone, index) =>
    firstUnknown >= 0 && index >= firstUnknown
      ? 'upcoming'
      : isDone
        ? 'done'
        : index === firstUndone
          ? 'current'
          : 'upcoming'
  );
}

export function SetupScreen(props: {
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
  const { instance } = useAppData();
  const returnTo = props.from == null ? undefined : safeReturnTo(props.from);
  // The forge the reviewer came from decides which section leads the page:
  // from a GitLab diff, that host's connect is the filled control and the
  // GitHub rail quiets to outline.
  const fromHost = gitLabHostFromPath(returnTo);
  const gitlabHosts = instance.gitlab.hosts;
  // A section renders only when the deployment has something to offer there:
  // the instance answer arrives with the page, so these are certain from the
  // first paint, and a forge this ghdiff is not set up for is simply absent.
  const showGitHub = instance.github.oauth;
  const showGitLab = gitlabHosts.length > 0;

  return (
    <SetupChrome>
      <SetupHeading
        brand={instance.brand}
        intro={m.setup_screen_github_and_gitlab_intro()}
        notice={props.migrated === true ? <MigrationNotice /> : undefined}
        title={m.setup_screen_set_up_private_repository_access()}
      />

      {!showGitHub && !showGitLab ? (
        <p className="text-ink-muted mt-8 text-sm">
          {m.setup_screen_nothing_to_set_up()}
        </p>
      ) : (
        <>
          {showGitHub && (
            <GitHubSection
              account={props.account}
              last={!showGitLab}
              primary={fromHost == null}
              returnTo={returnTo}
            />
          )}

          {showGitLab && (
            <GitLabSection
              account={props.account}
              fromHost={fromHost}
              hosts={gitlabHosts}
              primary={fromHost != null || !showGitHub}
              returnTo={returnTo}
            />
          )}
        </>
      )}
    </SetupChrome>
  );
}

/**
 * The chrome both sections share: the scroll region, the colour toggle, and
 * the way home. This page is reachable with the left bar hidden, and no screen
 * in this app is a dead end.
 */
function SetupChrome({ children }: { children: ReactNode }) {
  const { colorMode } = useAppData();
  return (
    <main className="bg-surface flex min-h-0 flex-1 overflow-y-auto overscroll-none">
      <div className="fixed top-3 right-3 z-10 flex items-center gap-1">
        <LanguageMenu />
        <ColorModeToggle colorMode={colorMode} />
      </div>
      <div className="m-auto w-full max-w-2xl px-6 py-14">{children}</div>
    </main>
  );
}

/** The way home, then what this page sets up and how long it takes. */
function SetupHeading({
  brand,
  intro,
  notice,
  title,
}: {
  /** What the deployment calls itself, which is what the way home names. */
  brand: string;
  intro: string;
  /** A banner between the way home and the title. The migration notice only. */
  notice?: ReactNode;
  title: string;
}) {
  return (
    <>
      <Link className="text-ink-faint hover:text-ink text-xs" to="/">
        {brand}
      </Link>
      {notice}
      <h1 className="text-ink mt-3 text-2xl font-semibold tracking-tight">
        {title}
      </h1>
      <p className="text-ink-muted mt-2 text-sm">{intro}</p>
    </>
  );
}

/**
 * The GitHub section: sign in, grant the App its reach, open the diff. The
 * first two are the two things GitHub needs, in a fixed order, and each step
 * reports its own state from what GitHub answered — a step is done because it
 * is done, and the rail cannot claim progress the App does not have.
 *
 * `primary` is false when the reviewer came from a GitLab diff: this section
 * is then the other forge's homework, and its controls stay outline so the
 * page keeps one filled control.
 */
function GitHubSection({
  account: named,
  last,
  primary,
  returnTo,
}: {
  account?: string;
  /** True when nothing follows the rail, so its last step draws no connector. */
  last: boolean;
  primary: boolean;
  returnTo?: string;
}) {
  const { session } = useAppData();
  // Only once GitHub has answered for the credential. Asking where the App is
  // installed before then would spend a request to be told "nobody", which is
  // the answer step one is about to change.
  const apps = useInstallations({ ready: !session.checking });

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
  // Two questions are asked of GitHub before this page knows anything, and each
  // step waits for its own. A signed-out reviewer is told where the App is
  // installed by nobody, so for them step two is known the moment step one is;
  // a failed read is an answer too, and it is printed rather than waited on.
  const appsPending = !apps.answered && apps.error == null;
  // Step three is never `done`: opening the diff is the thing this page hands
  // back, and it has no way to learn whether it worked.
  const [signIn, install, open] = stepStatuses(
    [signedIn, signedIn && installed, false],
    [!session.checking, !session.checking && (!signedIn || !appsPending)]
  ) as [StepStatus, StepStatus, StepStatus];

  return (
    <section className="mt-8">
      <SectionLabel>GitHub</SectionLabel>
      <div className="mt-3">
        <StepRail>
          <Step
            label={m.setup_screen_sign_in_to_github()}
            number={1}
            status={signIn}
          >
            {/* Both answers are a different height from the wait and from
                each other, so the step travels to whichever arrives rather
                than pushing the steps under it down in one frame. */}
            <AnimatedHeight>
              <div className="flex flex-col">
                {session.checking ? (
                  <SignInSkeleton />
                ) : session.viewer != null ? (
                  <IdentityCard viewer={session.viewer} />
                ) : (
                  <>
                    <p className="text-ink-muted text-sm">
                      {m.setup_screen_this_identifies_your_account_to_github_any_comments()}
                    </p>
                    <Button
                      className="mt-2 self-start"
                      onClick={() => session.signIn()}
                      variant={primary ? 'solid' : 'outline'}
                    >
                      <IconBrandGithub aria-hidden="true" size={14} />
                      {m.setup_screen_sign_in_with_github()}
                    </Button>
                  </>
                )}
              </div>
            </AnimatedHeight>
          </Step>

          <Step
            label={m.setup_screen_grant_repository_access()}
            number={2}
            status={install}
          >
            <p className="text-ink-muted text-sm">
              {account == null
                ? m.setup_screen_signing_in_only_identifies_you_choose_the_accounts()
                : m.setup_screen_signing_in_only_identifies_you_install_ghdiff_on(
                    { account }
                  )}
            </p>

            <AnimatedHeight>
              <div className="flex flex-col gap-1.5">
                {apps.error != null && (
                  <p className="text-removed mt-2 text-sm">{apps.error}</p>
                )}

                {/* The rows are guessed only for a reviewer GitHub may answer with
                some: a signed-out one is told about no account at all. The
                two buttons are reserved either way, because the install
                address arrives with the same answer. */}
                {appsPending && (
                  <InstallationsSkeleton rows={session.checking || signedIn} />
                )}

                {apps.installations.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    <SectionLabel>
                      {m.setup_screen_accounts_with_access()}
                    </SectionLabel>
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
                      // Filled only on the step that is actually next, and only on
                      // the section the reviewer came for. Two filled controls on
                      // one screen is the one thing this app's accent rule
                      // forbids.
                      className={buttonClass({
                        variant:
                          install === 'current' && primary
                            ? 'solid'
                            : 'outline',
                      })}
                      href={apps.installUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {apps.installations.length === 0
                        ? m.setup_screen_install_ghdiff()
                        : m.setup_screen_install_on_another_account()}
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
                      {apps.loading
                        ? m.setup_screen_checking()
                        : m.setup_screen_check_again()}
                    </Button>
                  </div>
                )}

                {/* Only GitHub's own answer about this reviewer can say the App is
                not on an account. Signed out, the list is empty because
                nobody was asked, and "not installed" would be a guess. */}
                {signedIn &&
                  apps.answered &&
                  account != null &&
                  wanted == null &&
                  !apps.loading && (
                    <StepNote>
                      <ParaglideMessage
                        message={m.setup_not_installed}
                        inputs={{ account }}
                        markup={setupMarkup}
                      />
                    </StepNote>
                  )}
                {wanted != null && !reachesAnyRepository(wanted) && (
                  <StepNote>
                    <ParaglideMessage
                      message={m.setup_no_repositories}
                      inputs={{ account: account ?? '' }}
                      markup={setupMarkup}
                    />
                  </StepNote>
                )}
              </div>
            </AnimatedHeight>
          </Step>

          <OpenDiffStep
            last={last}
            number={3}
            primary={primary}
            returnTo={returnTo}
            status={open}
          />
        </StepRail>
      </div>

      {apps.installUrl == null && !session.checking && (
        <p className="text-ink-faint mt-4 text-xs">
          {m.setup_screen_this_ghdiff_deployment_has_no_github_app_set()}
        </p>
      )}
    </section>
  );
}

/**
 * The GitLab section: one step per configured host, then open the diff. Which
 * way a connect goes is the deployment's answer, not the reviewer's choice:
 * OAuth leads when the host has an application registered here — one press on
 * its own consent screen — and a personal access token is the universal path
 * every instance has.
 *
 * `primary` is true when the reviewer came from a GitLab diff: that host's
 * step is the current one and its connect is the page's filled control.
 */
function GitLabSection({
  account: named,
  fromHost,
  hosts,
  primary,
  returnTo,
}: {
  account?: string;
  /** The host the `from` path's diff lives on, when it is a GitLab one. */
  fromHost?: string;
  hosts: InstanceInfo['gitlab']['hosts'];
  primary: boolean;
  returnTo?: string;
}) {
  const { session } = useAppData();
  const account = named ?? accountFromPath(returnTo);

  const statuses: StepStatus[] = hosts.map(({ host }) => {
    if (gitLabConnectionFor(session.gitlab, host) != null) return 'done';
    if (fromHost != null) return host === fromHost ? 'current' : 'upcoming';
    return 'upcoming';
  });
  // No `from` to point at one host: the first unconnected one is next.
  if (fromHost == null) {
    const first = statuses.findIndex((status) => status !== 'done');
    if (first >= 0) statuses[first] = 'current';
  }
  const openReady =
    fromHost != null
      ? gitLabConnectionFor(session.gitlab, fromHost) != null
      : session.gitlab.length > 0;

  return (
    <section className="mt-8">
      <SectionLabel>GitLab</SectionLabel>
      <p className="text-ink-muted mt-2 text-sm">
        {m.setup_screen_gitlab_connection_reads_whatever()}
      </p>
      <div className="mt-3">
        <StepRail>
          {hosts.map(({ host }, index) => (
            <GitLabHostStep
              key={host}
              account={host === fromHost ? account : undefined}
              host={host}
              number={index + 1}
              primary={primary && host === fromHost}
              status={statuses[index]}
            />
          ))}
          <OpenDiffStep
            last
            number={hosts.length + 1}
            primary={primary}
            returnTo={returnTo}
            status={openReady ? 'current' : 'upcoming'}
          />
        </StepRail>
      </div>
    </section>
  );
}

/** One host's connect step: the way in, or who the host already sees. */
function GitLabHostStep({
  account,
  host,
  number,
  primary,
  status,
}: {
  /** The project the reviewer came from, when this host is the one. */
  account?: string;
  host: string;
  number: number;
  /** True when this step's connect is the page's one filled control. */
  primary: boolean;
  status: StepStatus;
}) {
  const { session } = useAppData();
  const connection = gitLabConnectionFor(session.gitlab, host);
  const oauth = useGitLabOAuth(host);
  // Back to this page, so the step after the consent screen is still here.
  const here = useLocation({
    select: (location) => `${location.pathname}${location.searchStr}`,
  });

  return (
    <Step
      label={m.setup_screen_connect_to_host({ host })}
      number={number}
      status={status}
    >
      {connection != null ? (
        <IdentityCard viewer={connection.viewer} />
      ) : (
        <>
          <p className="text-ink-muted text-sm">
            {m.setup_screen_this_identifies_your_account_to_gitlab_on({ host })}
          </p>
          {oauth === true && (
            <>
              <a
                className={buttonClass({
                  className: 'mt-2 self-start',
                  variant: primary ? 'solid' : 'outline',
                })}
                href={gitLabAuthStartUrl(host, here)}
              >
                <GitLabMark aria-hidden="true" size={14} />
                {m.setup_screen_sign_in_with_gitlab()}
              </a>
              <p className="text-ink-faint mt-2 text-xs">
                {m.setup_screen_one_press_on_the_instances_own_consent()}
              </p>
            </>
          )}
          <div className="mt-3">
            <GitLabPatForm
              connectVariant={
                oauth === true ? 'outline' : primary ? 'solid' : 'outline'
              }
              host={host}
            />
          </div>
          {account != null && (
            <StepNote>
              <ParaglideMessage
                message={m.setup_came_from_a_diff_in}
                inputs={{ account }}
                markup={setupMarkup}
              />
            </StepNote>
          )}
        </>
      )}
    </Step>
  );
}

/** The done state of either section's first step: who the forge sees. */
function IdentityCard({ viewer }: { viewer: GitHubViewer }) {
  return (
    <div className={`${CARD} flex items-center gap-2.5`}>
      <ViewerAvatar size={22} viewer={viewer} />
      <span className="text-ink min-w-0 truncate text-sm">
        {viewerDisplayName(viewer)}
      </span>
    </div>
  );
}

/**
 * The last step of a section: the way back to the diff the reviewer came
 * from, or to the home page when there was none. A plain anchor and a whole
 * page load, not a client navigation — the point of coming back is a fresh
 * request to the forge under the grant that did not exist a minute ago. It is
 * never `done`: opening the diff is the thing this page hands back, and it has
 * no way to learn whether it worked.
 */
function OpenDiffStep({
  last = false,
  number,
  primary,
  returnTo,
  status,
}: {
  last?: boolean;
  number: number;
  /** False quiets the link to outline: the filled control is the other section's. */
  primary: boolean;
  returnTo?: string;
  status: StepStatus;
}) {
  const home = returnTo == null || returnTo === '/';
  return (
    <Step
      label={m.setup_screen_open_the_diff()}
      last={last}
      number={number}
      status={status}
    >
      <p className="text-ink-muted text-sm">
        {home
          ? m.setup_screen_go_to_the_home_page_to_paste_any()
          : m.setup_screen_return_to_your_diff_ghdiff_will_fetch_it()}
      </p>
      <a
        className={buttonClass({
          className: 'mt-2 self-start',
          variant: status === 'current' && primary ? 'solid' : 'outline',
        })}
        href={home ? '/' : returnTo}
      >
        {home
          ? m.setup_screen_go_to_ghdiff_home()
          : m.setup_screen_return_to_the_diff()}
      </a>
    </Step>
  );
}

/**
 * What a skeleton's bars pulse with. Only the bars: the cards and the label
 * around them are real and stay still, so the page reads as waiting for its
 * content rather than as fading out.
 */
const PULSE = 'animate-pulse motion-reduce:animate-none';

/**
 * Step one before GitHub has said who this is: the signed-in card's shape, an
 * avatar and a name. It is a guess at one of the two answers and the box
 * travels to the other, which is the cheaper miss — the sign-in copy is the
 * taller of the two, and a skeleton that guessed it would shrink under every
 * reviewer who is already signed in.
 */
function SignInSkeleton() {
  return (
    <div className={CARD} role="status">
      <span className="sr-only">{m.setup_screen_checking()}</span>
      <div aria-hidden="true" className={`flex items-center gap-2.5 ${PULSE}`}>
        <SkeletonBar className="size-[22px] shrink-0 rounded-full" />
        <span className="text-sm">
          <SkeletonBar className="inline-block h-[0.75em] w-32 align-middle" />
        </span>
      </div>
    </div>
  );
}

/** Varied per row, so the guess does not read as a table. */
const SKELETON_ROWS: readonly { name: string; reach: string }[] = [
  { name: 'w-24', reach: 'w-28' },
  { name: 'w-32', reach: 'w-24' },
];

/**
 * Step two before GitHub has said where the App is installed. Each row is the
 * real row's own skeleton inside the real row's card, so a row that lands where
 * a placeholder was lands on its pixel; the two buttons are bars the size of a
 * medium control.
 */
function InstallationsSkeleton({ rows }: { rows: boolean }) {
  return (
    // The gap is the step body's own, so the rows and the buttons sit as far
    // apart here as they will once they are two separate children of it.
    <div className="flex flex-col gap-1.5" role="status">
      <span className="sr-only">
        {m.git_hub_account_panel_checking_which_github_accounts_ghdiff_can_read()}
      </span>
      {rows && (
        <div aria-hidden="true" className="mt-2 flex flex-col gap-1.5">
          <SectionLabel>{m.setup_screen_accounts_with_access()}</SectionLabel>
          {SKELETON_ROWS.map((widths, index) => (
            <div key={index} className={CARD}>
              <InstallationRowSkeleton
                className={PULSE}
                nameWidth={widths.name}
                reachWidth={widths.reach}
              />
            </div>
          ))}
        </div>
      )}
      <div aria-hidden="true" className={`mt-3 flex gap-2 ${PULSE}`}>
        <SkeletonBar className="h-8 w-32 rounded-md" />
        <SkeletonBar className="h-8 w-28 rounded-md" />
      </div>
    </div>
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
        {m.setup_screen_ghdiff_now_uses_a_github_app()}
      </p>
      <p className="text-ink-muted mt-1 text-sm text-pretty">
        {m.setup_screen_ghdiff_removed_your_old_personal_access_token_from()}
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
        {m.setup_screen_delete_the_token_on_github()}
        <IconArrowUpRight aria-hidden="true" size={12} />
      </a>
    </div>
  );
}
