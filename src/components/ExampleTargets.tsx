import { Link } from '@tanstack/react-router';

import { EXAMPLE_TARGETS } from '@/lib/exampleTargets';
import { describeReviewTarget, reviewTargetSplat } from '@/lib/reviewTarget';

/**
 * Diffs to open when there is nothing of your own to review yet.
 *
 * The rows read like `PullRow` on purpose: title first, then the thing itself in
 * mono underneath. What is different is the right edge, which carries the size.
 * The size is the reason to pick one row over another here, and a reviewer who
 * wants to see what the surface does with 2,188 files should not have to open
 * three of them to find it.
 */
export function ExampleTargets() {
  return (
    <ul>
      {EXAMPLE_TARGETS.map((example) => (
        <li key={reviewTargetSplat(example.target)}>
          <Link
            to="/gh/$"
            params={{ _splat: reviewTargetSplat(example.target) }}
            className="hover:bg-raised focus-visible:bg-raised block rounded-md px-2 py-1.5 text-sm outline-none"
            title={example.note}
          >
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="text-ink min-w-0 flex-1 truncate">
                {example.title}
              </span>
              <span className="text-ink-faint shrink-0 text-[11px] tabular-nums">
                {example.scale}
              </span>
            </span>
            <span className="text-ink-faint block truncate font-mono text-[11px]">
              {describeReviewTarget(example.target)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
