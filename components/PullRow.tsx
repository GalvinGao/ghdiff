'use client';

import { IconCheck } from '@pierre/icons';
import Link from 'next/link';

import { PullStateIcon } from '@/components/PullStateIcon';
import { cn } from '@/lib/cn';
import type { PullSummary } from '@/lib/pullSwitcher';
import { type GitHubPullTarget, reviewTargetHref } from '@/lib/reviewTarget';

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
 * One pull request, as a link. The switcher menu and the home page both list
 * pull requests, and a row that looked different in the two places would read
 * as two different things.
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
      href={reviewTargetHref({
        kind: 'github-pull',
        owner: pull.owner,
        repo: pull.repo,
        number: pull.number,
      })}
      aria-current={isCurrent ? 'page' : undefined}
      onClick={onNavigate}
      className={cn(
        'hover:bg-surface focus-visible:bg-surface block rounded-md px-2 py-1.5 text-sm outline-none',
        isCurrent && 'bg-surface'
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <PullStateIcon state={pull.state} />
        <span className="text-ink-faint shrink-0 font-mono text-xs tabular-nums">
          #{pull.number}
        </span>
        <span
          className={cn(
            'text-ink min-w-0 flex-1 truncate',
            isCurrent && 'font-medium'
          )}
        >
          {pull.title}
        </span>
        {isCurrent && (
          <span className="text-accent shrink-0" title="Under review now">
            <IconCheck size={14} />
          </span>
        )}
      </span>
      <span className="text-ink-faint block truncate pl-6 text-xs">
        {pull.owner}/{pull.repo} · {pull.headRef} into {pull.baseRef}
      </span>
    </Link>
  );
}
