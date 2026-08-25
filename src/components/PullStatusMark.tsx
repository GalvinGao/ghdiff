import { useId } from 'react';

import { cn } from '@/lib/cn';
import {
  checkTone,
  describePullStatus,
  type PullReviewStatus,
  reviewTone,
  type StatusTone,
} from '@/lib/pullStatus';

// The review and the checks, as one small square split down the middle: the left
// half is the review and the right half is the checks. GalvinGao/floodgate
// paints this into the favicon of every pull request tab, and reviewer paints
// the same square beside every row, so the two read as one language.
//
// The white "+" over the review half carries floodgate's own meaning: somebody
// asked for changes and the author has pushed since, so the red half may already
// be answered.

const FILL: Record<StatusTone, string> = {
  success: 'var(--app-status-success)',
  pending: 'var(--app-status-pending)',
  failure: 'var(--app-status-failure)',
  neutral: 'var(--app-status-neutral)',
};

// One coordinate space for every size, in floodgate's proportions: a rounded
// square, a transparent gap down the middle, and the "+" centred on the painted
// left half rather than on the geometric centre.
const BOX = 32;
const GAP = 2;
const MID = BOX / 2;
const RADIUS = 7;
const PLUS = { cx: (1 + (MID - GAP)) / 2, cy: MID, arm: 5.5, thick: 4 };

export function PullStatusMark({
  className,
  size = 13,
  status,
}: {
  className?: string;
  size?: number;
  status: PullReviewStatus;
}) {
  // The clip path is referenced by id, and a list draws many of these.
  const clipId = useId();
  const label = describePullStatus(status);
  return (
    <svg
      aria-label={label}
      className={cn('shrink-0', className)}
      height={size}
      role="img"
      viewBox={`0 0 ${BOX} ${BOX}`}
      width={size}
    >
      <title>{label}</title>
      <defs>
        <clipPath id={clipId}>
          <rect height={BOX - 2} rx={RADIUS} width={BOX - 2} x={1} y={1} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect
          fill={FILL[reviewTone(status.review)]}
          height={BOX}
          width={MID - GAP}
          x={0}
          y={0}
        />
        <rect
          fill={FILL[checkTone(status.check)]}
          height={BOX}
          width={BOX - (MID + GAP)}
          x={MID + GAP}
          y={0}
        />
        {status.commitsSinceChanges === true && (
          <>
            <rect
              fill="#ffffff"
              height={PLUS.thick}
              width={PLUS.arm * 2}
              x={PLUS.cx - PLUS.arm}
              y={PLUS.cy - PLUS.thick / 2}
            />
            <rect
              fill="#ffffff"
              height={PLUS.arm * 2}
              width={PLUS.thick}
              x={PLUS.cx - PLUS.thick / 2}
              y={PLUS.cy - PLUS.arm}
            />
          </>
        )}
      </g>
    </svg>
  );
}
