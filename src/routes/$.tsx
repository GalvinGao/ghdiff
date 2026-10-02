import { createFileRoute, notFound } from '@tanstack/react-router';

import { ReviewScreen } from '@/components/ReviewScreen';
import { gitHubTargetFromSegments, reviewTargetKey } from '@/lib/reviewTarget';

// Mirrors github.com's own paths at the root of the site, so a pull request URL
// becomes a ghdiff URL by swapping the host and nothing else. The splat holds
// the whole path, already percent-decoded by the router.
//
// Every static route in the app — `/` and each `/api/...` handler — outranks
// this one, so the splat only sees a path nothing else claimed. A path that is
// not a target on GitHub is a 404 rather than an empty review.
export const Route = createFileRoute('/$')({
  loader: ({ params }) => {
    const target = gitHubTargetFromSegments(params._splat?.split('/') ?? []);
    if (target == null) {
      throw notFound();
    }
    return target;
  },
  component: GitHubReviewRoute,
});

// Keyed by the target, because every piece of state on that screen belongs to
// one diff: the pull request's details, the reviewer's verdict, the filter,
// the folds. A move to the next pull request reuses this route, and without a
// key the header went on naming the last one until GitHub answered for the
// new one.
function GitHubReviewRoute() {
  const target = Route.useLoaderData();
  return <ReviewScreen key={reviewTargetKey(target)} target={target} />;
}
