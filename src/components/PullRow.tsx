import { IconCheck } from '@pierre/icons';
import { Link } from '@tanstack/react-router';

import { pullStateLabel } from '@/components/PullStateIcon';
import { PullStatusMark } from '@/components/PullStatusMark';
import { railPullFlipKey } from '@/hooks/useRailFlip';
import { cn } from '@/lib/cn';
import type { PullSummary } from '@/lib/pulls';
import { describePullStatus } from '@/lib/pullStatus';
import { type GitHubPullTarget, reviewTargetSplat } from '@/lib/reviewTarget';

// The leading lane of a row holds the status square, and nothing else. The
// lifecycle octicon that stood beside it repeated what the list already says —
// every pull request the list holds is open — and it took half the lane from the
// one glyph that carries new information.
//
// The lane keeps its width when it has no square to hold. A reviewer with no
// token never had the review and the check axes fetched, and a row that closed
// the gap would start its number under the previous row's title.
const MARK_SIZE = 13;
/** `gap-1.5`: what stands between the lane and the number. */
const MARK_GAP = 6;
/**
 * Where `#123` starts, and so where the head branch starts on the line below.
 * The two lines are one column, not two ragged ones.
 */
const TEXT_INSET = MARK_SIZE + MARK_GAP;

/** True when this row is the pull request already under review. */
export function isCurrentPull(
  pull: PullSummary,
  current?: GitHubPullTarget
): boolean {
  return (
    current != null &&
    current.owner === pull.owner &&
    current.repo === pull.repo &&
    current.number === pull.number
  );
}

/**
 * One pull request, as a link. The left bar and the home page both list pull
 * requests, and a row that looked different in the two places would read as two
 * different things.
 *
 * The repository is not on the row: it is the heading of the group the row sits
 * in. The head branch is, because that is what a stack is built out of.
 */
export function PullRow({
  current,
  onNavigate,
  pull,
}: {
  current?: GitHubPullTarget;
  onNavigate?(): void;
  pull: PullSummary;
}) {
  const isCurrent = isCurrentPull(pull, current);
  return (
    <Link
      to="/$"
      params={{
        _splat: reviewTargetSplat({
          kind: 'github-pull',
          owner: pull.owner,
          repo: pull.repo,
          number: pull.number,
        }),
      }}
      aria-current={isCurrent ? 'page' : undefined}
      onClick={onNavigate}
      className={cn(
        'hover:bg-raised focus-visible:bg-raised block select-none rounded-md px-2 py-1.5 text-sm outline-none',
        isCurrent && 'bg-raised'
      )}
      title={`${pull.title}\n${pullStateLabel(pull.state)}${
        pull.status == null ? '' : ` · ${describePullStatus(pull.status)}`
      }\n${pull.headRef} into ${pull.baseRef}`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {/* The flip mark pairs this lane with the same pull request's square
            in the collapsed bar, so toggling the bar flies one square between
            the two layouts (hooks/useRailFlip.ts). An empty lane is not
            marked: a flight needs a square to fly. */}
        <span
          className="flex shrink-0 items-center justify-center"
          data-rail-flip={
            pull.status == null ? undefined : railPullFlipKey(pull)
          }
          style={{ width: MARK_SIZE }}
        >
          {pull.status != null && (
            <PullStatusMark size={MARK_SIZE} status={pull.status} />
          )}
        </span>
        <span className="text-ink-faint shrink-0 font-mono text-xs tabular-nums">
          #{pull.number}
        </span>
        {/* The one piece of lifecycle the square cannot carry. It rides a chip
            rather than a glyph of its own, so an open pull request — which is
            almost every row — pays nothing for it. */}
        {pull.state === 'draft' && (
          <span className="border-line text-ink-faint shrink-0 rounded border px-1 text-[10px] leading-4">
            Draft
          </span>
        )}
        <span
          className={cn(
            'text-ink min-w-0 flex-1 truncate',
            isCurrent && 'font-medium'
          )}
        >
          {pull.title}
        </span>
        {isCurrent && (
          <span className="text-accent shrink-0" title="Currently viewing">
            <IconCheck size={14} />
          </span>
        )}
      </span>
      <span
        className="text-ink-faint block truncate font-mono text-[11px]"
        style={{ paddingLeft: TEXT_INSET }}
      >
        {pull.headRef}
      </span>
    </Link>
  );
}
