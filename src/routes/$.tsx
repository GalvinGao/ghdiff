import { createFileRoute, notFound } from '@tanstack/react-router';

import { ReviewScreen } from '@/components/ReviewScreen';
import { gitHubTargetFromSegments } from '@/lib/reviewTarget';

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

function GitHubReviewRoute() {
  return <ReviewScreen target={Route.useLoaderData()} />;
}
