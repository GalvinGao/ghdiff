'use client';

import { PullStateIcon, pullStateLabel } from '@/components/PullStateIcon';
import { PullStatusMark } from '@/components/PullStatusMark';
import type { PullState } from '@/lib/pulls';
import { describePullStatus, type PullReviewStatus } from '@/lib/pullStatus';

/**
 * What a pull request is, and where it stands, as one glyph pair: GitHub's own
 * octicon for the lifecycle, and floodgate's split square for the review and the
 * checks.
 *
 * The square is left off a merged or closed pull request, where the octicon has
 * already said everything that matters, and off a pull request read without a
 * token, where reviewer never asked GitHub for the two axes.
 */
export function PullStatusIcon({
  state,
  status,
}: {
  state: PullState;
  status?: PullReviewStatus;
}) {
  const showMark = status != null && (state === 'open' || state === 'draft');
  return (
    <span
      className="flex shrink-0 items-center gap-1"
      title={
        showMark
          ? `${pullStateLabel(state)} · ${describePullStatus(status)}`
          : pullStateLabel(state)
      }
    >
      <PullStateIcon state={state} />
      {showMark && <PullStatusMark status={status} />}
    </span>
  );
}
