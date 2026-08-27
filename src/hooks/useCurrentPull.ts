import { useLocation } from '@tanstack/react-router';
import { useMemo } from 'react';

import {
  type GitHubPullTarget,
  gitHubTargetFromSegments,
} from '@/lib/reviewTarget';

/**
 * The pull request the path names, if the path names one.
 *
 * Read from the path rather than from a route's params, because everything
 * that asks — the left bar, and the button that stands in for it on a phone —
 * sits above every route and has to work the same over the home page, a review
 * and a 404 alike. `useLocation` re-renders the caller on each navigation.
 */
export function useCurrentPull(): GitHubPullTarget | undefined {
  const pathname = useLocation({ select: (location) => location.pathname });
  return useMemo(() => {
    const segments = pathname.split('/').filter((part) => part.length > 0);
    // A `/gh` prefix redirects to the same path without it. The redirect is one
    // navigation away, and reading through the prefix keeps the row highlighted
    // for that navigation instead of blinking off and on.
    const path = segments[0] === 'gh' ? segments.slice(1) : segments;
    const target = gitHubTargetFromSegments(path);
    return target?.kind === 'github-pull' ? target : undefined;
  }, [pathname]);
}
