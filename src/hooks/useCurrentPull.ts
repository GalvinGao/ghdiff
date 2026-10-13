import { useLocation } from '@tanstack/react-router';
import { useMemo } from 'react';

import { isGitLabTarget } from '@/lib/forges';
import type { PullTarget } from '@/lib/pullScope';
import {
  type ReviewTarget,
  reviewTargetFromSegments,
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
export function useCurrentReviewTarget(): ReviewTarget | undefined {
  const pathname = useLocation({ select: (location) => location.pathname });
  return useMemo(() => {
    const segments = pathname.split('/').filter((part) => part.length > 0);
    // A `/gh` prefix redirects to the same path without it. The redirect is one
    // navigation away, and reading through the prefix keeps the row highlighted
    // for that navigation instead of blinking off and on.
    const path = segments[0] === 'gh' ? segments.slice(1) : segments;
    return reviewTargetFromSegments(path);
  }, [pathname]);
}

/** The pull request or merge request the path names, if it names one. */
export function useCurrentPull(): PullTarget | undefined {
  const target = useCurrentReviewTarget();
  return target?.kind === 'github-pull' || target?.kind === 'gitlab-mr'
    ? target
    : undefined;
}

/**
 * The account whose code is on screen, whatever kind of target it is.
 *
 * Every target has an owner — a pull request, a commit and a compare range
 * alike — and the account menu marks that row in its list of installations,
 * because which of them the diff in front of the reviewer belongs to is the one
 * they are being asked about. So this asks for the owner rather than for a pull
 * request.
 */
export function useCurrentAccount(): string | undefined {
  const target = useCurrentReviewTarget();
  // A GitLab namespace is not a GitHub account, and the menu's rows are
  // GitHub installations — so only a GitHub target has a row to mark.
  return target != null &&
    target.kind !== 'local-diff' &&
    !isGitLabTarget(target)
    ? target.owner
    : undefined;
}
