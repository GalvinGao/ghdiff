import { useLocation } from '@tanstack/react-router';
import { useMemo } from 'react';

import {
  type GitHubPullTarget,
  gitHubTargetFromSegments,
  type ReviewTarget,
} from '@/lib/reviewTarget';

/**
 * Whatever review target the path names, if it names one.
 *
 * Read from the path rather than from a route's params, because everything that
 * asks — the left bar, the button that stands in for it on a phone, the account
 * menu — sits above every route and has to work the same over the home page, a
 * review and a 404 alike. `useLocation` re-renders the caller on each
 * navigation.
 */
function useCurrentTarget(): ReviewTarget | undefined {
  const pathname = useLocation({ select: (location) => location.pathname });
  return useMemo(() => {
    const segments = pathname.split('/').filter((part) => part.length > 0);
    // A `/gh` prefix redirects to the same path without it. The redirect is one
    // navigation away, and reading through the prefix keeps the row highlighted
    // for that navigation instead of blinking off and on.
    const path = segments[0] === 'gh' ? segments.slice(1) : segments;
    return gitHubTargetFromSegments(path);
  }, [pathname]);
}

/** The pull request the path names, if the path names one. */
export function useCurrentPull(): GitHubPullTarget | undefined {
  const target = useCurrentTarget();
  return target?.kind === 'github-pull' ? target : undefined;
}

/**
 * The account whose code is on screen, whatever kind of target it is.
 *
 * Every target has an owner — a pull request, a commit and a compare range
 * alike — and the account menu marks that row in its list of installations,
 * because which of them the diff in front of the reviewer belongs to is the one
 * they are being asked about. So this asks for the owner rather than for a pull
 * request, which is what separates it from `useCurrentPull`.
 */
export function useCurrentAccount(): string | undefined {
  return useCurrentTarget()?.owner;
}
