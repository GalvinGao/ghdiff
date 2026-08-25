import { createFileRoute, notFound } from '@tanstack/react-router';

import { ReviewScreen } from '@/components/ReviewScreen';
import { gitHubTargetFromSegments } from '@/lib/reviewTarget';

// Mirrors github.com's own paths, so pasting a pull request URL into reviewer
// needs nothing more than a host swap. The splat holds everything after `/gh/`,
// already percent-decoded by the router.
export const Route = createFileRoute('/gh/$')({
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
