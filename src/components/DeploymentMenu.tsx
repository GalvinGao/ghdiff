import { GlobeIcon } from '@primer/octicons-react/GlobeIcon';
import { MarkGithubIcon } from '@primer/octicons-react/MarkGithubIcon';
import { RocketIcon } from '@primer/octicons-react/RocketIcon';
import { useState } from 'react';

import { m } from '../paraglide/messages.js';
import { AuthorAvatar } from '@/components/AuthorAvatar';
import { Button } from '@/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { Spinner } from '@/components/ui/Spinner';
import { useDeployments } from '@/hooks/useDeployments';
import type { GitHubSessionState } from '@/hooks/useGitHubSession';
import { cn } from '@/lib/cn';
import {
  type Deployment,
  type DeploymentState,
  deploymentProvider,
  type EnvironmentLatest,
  type EnvironmentReading,
  latestByEnvironment,
  newestFirst,
} from '@/lib/deployments';
import { describeAge } from '@/lib/pullDetails';
import type { GitHubReviewTarget } from '@/lib/reviewTarget';

/**
 * The full history is a scroll away under the latest rows. Twenty pushes of a
 * few environments each is well past what a reviewer reads down to; the rest
 * are one press away on GitHub.
 */
const MAX_ALL_ROWS = 30;

// Every label is a getter, read while rendering: a message called while the
// module loads would freeze one request's locale for every request after it.
const READING: Record<
  EnvironmentReading,
  {
    readonly label: string;
    dot: string;
    tone: 'ok' | 'wait' | 'bad' | 'quiet';
  }
> = {
  current: {
    get label() {
      return m.deployment_menu_ready();
    },
    dot: 'bg-status-success',
    tone: 'ok',
  },
  building: {
    get label() {
      return m.deployment_menu_building();
    },
    dot: 'bg-status-pending',
    tone: 'wait',
  },
  waiting: {
    get label() {
      return m.deployment_menu_waiting();
    },
    dot: 'bg-status-pending',
    tone: 'wait',
  },
  failed: {
    get label() {
      return m.deployment_menu_failed();
    },
    dot: 'bg-status-failure',
    tone: 'bad',
  },
  outdated: {
    get label() {
      return m.deployment_menu_outdated();
    },
    dot: 'bg-status-neutral',
    tone: 'quiet',
  },
};

const STATE_DOT: Record<DeploymentState, string> = {
  success: 'bg-status-success',
  inactive: 'bg-status-neutral',
  pending: 'bg-status-pending',
  failure: 'bg-status-failure',
  unknown: 'bg-status-neutral',
};

function stateLabel(state: DeploymentState): string {
  switch (state) {
    case 'success':
      return m.deployment_menu_ready();
    case 'inactive':
      return m.deployment_menu_replaced();
    case 'pending':
      return m.deployment_menu_building();
    case 'failure':
      return m.deployment_menu_failed();
    case 'unknown':
      return m.deployment_menu_no_status();
  }
}

/**
 * The way to the code under review running somewhere, beside the verdict.
 *
 * Every environment GitHub has a deployment for gets one row at the top, and
 * the row says whether it has caught up with the head: a reviewer choosing a
 * preview is choosing by provider, and wants the newest build each one has.
 * Every deployment follows, newest first, for the reviewer who wants the build
 * of one particular push. A press on either opens the build itself.
 *
 * Nothing is drawn for a target with no deployments, which is most of them. The
 * button arrives after the header's first paint, and it is the leftmost of its
 * group, so its arrival moves nothing to its right.
 */
export function DeploymentMenu({
  session,
  target,
}: {
  session: GitHubSessionState;
  target: GitHubReviewTarget;
}) {
  const query = useDeployments({
    target,
    signedIn: session.signedIn,
    checking: session.checking,
  });
  // Stamped when the menu opens, so every age in it is read from one instant
  // and no clock runs behind a closed menu.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const data = query.data;
  if (data == null || data.deployments.length === 0) return null;

  const latest = latestByEnvironment(data);
  const all = newestFirst(data.deployments);
  const summary = summarize(latest);

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => setOpenedAt(open ? Date.now() : null)}
    >
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={m.deployment_menu_trigger({ state: summary.label })}
          className="shrink-0"
          size="icon"
          title={m.deployment_menu_trigger({ state: summary.label })}
          variant="chrome"
        >
          <span className="relative inline-flex">
            <RocketIcon size={15} />
            <span
              aria-hidden="true"
              className={cn(
                'ring-surface absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-2',
                summary.dot,
                summary.tone === 'wait' &&
                  'animate-pulse motion-reduce:animate-none'
              )}
            />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[min(25rem,calc(100vw-1rem))]"
      >
        <DropdownMenuLabel>{m.deployment_menu_latest()}</DropdownMenuLabel>
        {latest.map((row) => (
          <LatestRow
            key={row.environment}
            headSha={data.headSha}
            now={openedAt}
            row={row}
          />
        ))}
        {/* The history only earns its section when it holds something the
            rows above do not: one build per environment is already all there
            is. */}
        {all.length > latest.length && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{m.deployment_menu_all()}</DropdownMenuLabel>
            {all.slice(0, MAX_ALL_ROWS).map((deployment) => (
              <HistoryRow
                key={deployment.id}
                deployment={deployment}
                headSha={data.headSha}
                now={openedAt}
              />
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The one dot the button wears. Something still building outranks everything,
 * because it is the answer about to change; a failure outranks a build that is
 * merely behind.
 */
function summarize(rows: EnvironmentLatest[]) {
  const readings = new Set(rows.map((row) => row.reading));
  const pick = (reading: EnvironmentReading) => READING[reading];
  if (readings.has('building')) return pick('building');
  if (readings.has('waiting')) return pick('waiting');
  if (readings.has('failed')) return pick('failed');
  if (readings.has('outdated')) return pick('outdated');
  return pick('current');
}

function LatestRow({
  headSha,
  now,
  row,
}: {
  headSha?: string;
  now: number | null;
  row: EnvironmentLatest;
}) {
  const { environment, href, newest, reading, shown } = row;
  // Named from the build a press opens: a build still going has no address
  // yet, and the address is what says who serves it.
  const named = shown ?? newest;
  const provider = deploymentProvider(named);
  const quiet = reading === 'outdated';
  const body = (
    <>
      <ProviderMark deployment={named} />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate font-medium',
            quiet ? 'text-ink-muted' : 'text-ink'
          )}
        >
          {environment}
        </span>
        {/* The commit and the age of the build a press opens, which is not
            the newest build when that one is still going or failed. */}
        <span className="text-ink-faint flex min-w-0 items-baseline gap-1 text-xs">
          {/* `auto`, because the name is data in whatever script its author
              wrote it: an English description in an Arabic menu should still
              lose its end to the ellipsis, not its start. */}
          <span className="min-w-0 truncate" dir="auto">
            {provider.label}
          </span>
          <span className="shrink-0 font-mono">{shortSha(named.sha)}</span>
          <span aria-hidden="true" className="shrink-0">
            ·
          </span>
          <span className="shrink-0">
            {now == null ? null : describeAge(named.createdAt, now)}
          </span>
        </span>
      </span>
      {reading !== 'current' && <ReadingChip reading={reading} />}
    </>
  );
  const title = describeReading(row, headSha);

  if (href == null) {
    return (
      <DropdownMenuItem disabled className="gap-2.5" title={title}>
        {body}
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem asChild className="gap-2.5" title={title}>
      <a href={href} rel="noreferrer" target="_blank">
        {body}
      </a>
    </DropdownMenuItem>
  );
}

function ReadingChip({ reading }: { reading: EnvironmentReading }) {
  const spec = READING[reading];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
        spec.tone === 'bad' ? 'text-status-failure' : 'text-ink-muted',
        'bg-surface'
      )}
    >
      {spec.tone === 'wait' ? (
        <Spinner label={spec.label} size={10} />
      ) : (
        <span
          aria-hidden="true"
          className={cn('size-1.5 rounded-full', spec.dot)}
        />
      )}
      {spec.label}
    </span>
  );
}

/**
 * The sentence behind a row, for the tooltip: what state the head is in, and
 * which build the press opens when that is not the head's.
 */
function describeReading(
  row: EnvironmentLatest,
  headSha: string | undefined
): string {
  // The server always names the head; the newest build is the fallback for an
  // answer that somehow came back without one.
  const sha = shortSha(headSha ?? row.newest.sha);
  const state = (() => {
    switch (row.reading) {
      case 'current':
        return m.deployment_menu_head_ready({ sha });
      case 'building':
        return m.deployment_menu_head_building({ sha });
      case 'failed':
        return m.deployment_menu_head_failed({ sha });
      case 'waiting':
        return m.deployment_menu_head_waiting({ sha });
      case 'outdated':
        return m.deployment_menu_head_outdated({ sha });
    }
  })();
  const shown = row.shown?.sha;
  // Two whole sentences, each its own message, rather than one sentence
  // assembled from parts: the second is absent for a row that opens the head.
  if (shown === headSha && shown != null) return state;
  const opens =
    shown == null
      ? row.href == null
        ? m.deployment_menu_opens_nothing()
        : m.deployment_menu_opens_log()
      : m.deployment_menu_opens_build({ sha: shortSha(shown) });
  return `${state} ${opens}`;
}

function HistoryRow({
  deployment,
  headSha,
  now,
}: {
  deployment: Deployment;
  headSha?: string;
  now: number | null;
}) {
  const href = deployment.url ?? deployment.logUrl;
  const old = headSha != null && deployment.sha !== headSha;
  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          STATE_DOT[deployment.state]
        )}
      />
      <span className="shrink-0 font-mono text-xs">
        {shortSha(deployment.sha)}
      </span>
      <span className="min-w-0 flex-1 truncate">{deployment.environment}</span>
      <span className="text-ink-faint shrink-0 text-xs">
        {now == null ? null : describeAge(deployment.createdAt, now)}
      </span>
    </>
  );
  const title = old
    ? m.deployment_menu_older({ state: stateLabel(deployment.state) })
    : stateLabel(deployment.state);
  const className = cn('gap-2 py-1', old ? 'text-ink-faint' : 'text-ink');

  if (href == null) {
    return (
      <DropdownMenuItem disabled className={className} title={title}>
        {body}
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem asChild className={className} title={title}>
      <a href={href} rel="noreferrer" target="_blank">
        {body}
      </a>
    </DropdownMenuItem>
  );
}

/**
 * Which service answers at the address, in ink. The marks are monochrome on
 * purpose: this app's only colours are the diff's and the status palette's,
 * and a row of three brand colours would outshout the state beside it.
 */
function ProviderMark({ deployment }: { deployment: Deployment }) {
  const { id } = deploymentProvider(deployment);
  const box =
    'bg-surface text-ink-muted flex size-7 shrink-0 items-center justify-center rounded-md';
  switch (id) {
    case 'cloudflare':
      return (
        <span aria-hidden="true" className={box}>
          <svg fill="currentColor" height={16} viewBox="0 0 24 24" width={16}>
            <path d={CLOUDFLARE_PATH} />
          </svg>
        </span>
      );
    case 'vercel':
      return (
        <span aria-hidden="true" className={box}>
          <svg fill="currentColor" height={12} viewBox="0 0 24 24" width={12}>
            <path d="m12 1.608 12 20.784H0Z" />
          </svg>
        </span>
      );
    case 'netlify':
      return (
        <span aria-hidden="true" className={box}>
          <svg fill="currentColor" height={14} viewBox="0 0 24 24" width={14}>
            <path d={NETLIFY_PATH} />
          </svg>
        </span>
      );
    case 'github':
      return (
        <span aria-hidden="true" className={box}>
          <MarkGithubIcon size={14} />
        </span>
      );
    case 'other':
      return deployment.creatorAvatarUrl != null &&
        deployment.creatorLogin != null ? (
        <span aria-hidden="true" className={box}>
          <AuthorAvatar
            author={deployment.creatorLogin}
            avatarUrl={deployment.creatorAvatarUrl}
            isBot={deployment.creatorLogin.endsWith('[bot]')}
            size={16}
          />
        </span>
      ) : (
        <span aria-hidden="true" className={box}>
          <GlobeIcon size={14} />
        </span>
      );
  }
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

// simple-icons, CC0.
const CLOUDFLARE_PATH =
  'M16.5088 16.8447c.1475-.5068.0908-.9707-.1553-1.3154-.2246-.3164-.6045-.499-1.0615-.5205l-8.6592-.1123a.1559.1559 0 0 1-.1333-.0713c-.0283-.042-.0351-.0986-.021-.1553.0278-.084.1123-.1484.2036-.1562l8.7359-.1123c1.0351-.0489 2.1601-.8868 2.5537-1.9136l.499-1.3013c.0215-.0561.0293-.1128.0147-.168-.5625-2.5463-2.835-4.4453-5.5499-4.4453-2.5039 0-4.6284 1.6177-5.3876 3.8614-.4927-.3658-1.1187-.5625-1.794-.499-1.2026.119-2.1665 1.083-2.2861 2.2856-.0283.31-.0069.6128.0635.894C1.5683 13.171 0 14.7754 0 16.752c0 .1748.0142.3515.0352.5273.0141.083.0844.1475.1689.1475h15.9814c.0909 0 .1758-.0645.2032-.1553l.12-.4268zm2.7568-5.5634c-.0771 0-.1611 0-.2383.0112-.0566 0-.1054.0415-.127.0976l-.3378 1.1744c-.1475.5068-.0918.9707.1543 1.3164.2256.3164.6055.498 1.0625.5195l1.8437.1133c.0557 0 .1055.0263.1329.0703.0283.043.0351.1074.0214.1562-.0283.084-.1132.1485-.204.1553l-1.921.1123c-1.041.0488-2.1582.8867-2.5527 1.914l-.1406.3585c-.0283.0713.0215.1416.0986.1416h6.5977c.0771 0 .1474-.0489.169-.126.1122-.4082.1757-.837.1757-1.2803 0-2.6025-2.125-4.727-4.7344-4.727';
const NETLIFY_PATH =
  'M6.49 19.04h-.23L5.13 17.9v-.23l1.73-1.71h1.2l.15.15v1.2L6.5 19.04ZM5.13 6.31V6.1l1.13-1.13h.23L8.2 6.68v1.2l-.15.15h-1.2L5.13 6.31Zm9.96 9.09h-1.65l-.14-.13v-3.83c0-.68-.27-1.2-1.1-1.23-.42 0-.9 0-1.43.02l-.07.08v4.96l-.14.14H8.9l-.13-.14V8.73l.13-.14h3.7a2.6 2.6 0 0 1 2.61 2.6v4.08l-.13.14Zm-8.37-2.44H.14L0 12.82v-1.64l.14-.14h6.58l.14.14v1.64l-.14.14Zm17.14 0h-6.58l-.14-.14v-1.64l.14-.14h6.58l.14.14v1.64l-.14.14ZM11.05 6.55V1.64l.14-.14h1.65l.14.14v4.9l-.14.14h-1.65l-.14-.13Zm0 15.81v-4.9l.14-.14h1.65l.14.13v4.91l-.14.14h-1.65l-.14-.14Z';
