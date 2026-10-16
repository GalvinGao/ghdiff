import { createFileRoute, notFound, redirect } from '@tanstack/react-router';

import { ReviewScreen } from '@/components/ReviewScreen';
import { classifyRouteSegments, reviewTargetKey } from '@/lib/reviewTarget';

// Mirrors the forge's own paths at the root of the site, so a pull request URL
// becomes a ghdiff URL by swapping the host and nothing else. The splat holds
// the whole path, already percent-decoded by the router. The canonical form
// glues the forge host to the first segment with a colon; a hostless
// GitHub-shaped path is an entry point, and redirects trivially to the one
// GitHub host there is today.
//
// Every static route in the app — `/` and each `/api/...` handler — outranks
// this one, so the splat only sees a path nothing else claimed. A path that
// is not a target on a forge is a 404 rather than an empty review.
//
// The loader runs on the server for document requests and in the browser for
// navigations, so it stays client-safe: no server imports (they would leak
// into the client bundle) and no fetch of this same origin (workerd cannot
// fetch its own zone). Classification is pure — `classifyRouteSegments`.
export const Route = createFileRoute('/$')({
  loader: ({ params }) => {
    const parsed = classifyRouteSegments(params._splat?.split('/') ?? []);
    switch (parsed.kind) {
      case 'target':
        return parsed.target;
      case 'redirect':
        throw redirect({
          to: '/$',
          params: { _splat: parsed.splat },
          statusCode: parsed.status,
        });
      case 'none':
        throw notFound();
    }
  },
  component: ReviewRoute,
});

// Keyed by the target, because every piece of state on that screen belongs to
// one diff: the pull request's details, the reviewer's verdict, the filter,
// the folds. A move to the next pull request reuses this route, and without a
// key the header went on naming the last one until the forge answered for the
// new one — and an async completion still in flight from the last one would
// write itself into this one.
function ReviewRoute() {
  const target = Route.useLoaderData();
  return <ReviewScreen key={reviewTargetKey(target)} target={target} />;
}
