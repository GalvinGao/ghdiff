import { Link } from '@tanstack/react-router';

import { EXAMPLE_TARGETS } from '@/lib/exampleTargets';
import { reviewTargetDisplayPath, reviewTargetSplat } from '@/lib/reviewTarget';

/**
 * Diffs to open when there is nothing of your own to review yet.
 *
 * Each row is the path itself, which is the one thing the two lines above the
 * card just taught the reader to write. A title over a description of the
 * target said neither: it named a pull request nobody had heard of, and then
 * spelled the target as `owner/repo #123`, which is not what anybody types.
 *
 * The right edge keeps the size, because the size is the reason to pick one row
 * over another. A reviewer who wants to see what the surface does with 2,188
 * files should not have to open three of them to find it.
 */
export function ExampleTargets() {
  return (
    <ul className="font-mono text-xs">
      {EXAMPLE_TARGETS.map((example) => (
        <li key={reviewTargetSplat(example.target)}>
          <Link
            to="/$"
            params={{ _splat: reviewTargetSplat(example.target) }}
            className="hover:bg-raised focus-visible:bg-raised flex items-baseline gap-3 rounded-md px-2 py-1.5 outline-none"
            title={`${example.title} — ${example.note}`}
          >
            <span className="text-ink min-w-0 flex-1 truncate">
              <span className="text-ink-faint">/</span>
              {reviewTargetDisplayPath(example.target)}
            </span>
            <span className="text-ink-faint shrink-0 text-[11px] tabular-nums">
              {example.scale}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
