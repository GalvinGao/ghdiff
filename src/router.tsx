import { createRouter } from '@tanstack/react-router';

import { NotFound } from '@/components/NotFound';
import { RouteError } from '@/components/RouteError';
import { routeTree } from '@/routeTree.gen';

// The entry TanStack Start calls on the server for every document request, and
// once in the browser to hydrate. It must export `getRouter`.
export function getRouter() {
  return createRouter({
    routeTree,
    // The review route's chunk carries the whole diff viewer, so a pointer
    // resting on a row in the switcher starts that download before the click.
    // The patch itself is not preloaded here: the loader only reads the URL,
    // and `useReviewPatch` fetches once the screen mounts — unless the review
    // dialog already prefetched it for Approve and next.
    defaultPreload: 'intent',
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: RouteError,
    scrollRestoration: true,
  });
}
