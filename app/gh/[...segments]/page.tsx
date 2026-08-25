import { notFound } from 'next/navigation';

import { ReviewScreen } from '@/components/ReviewScreen';
import { gitHubTargetFromSegments } from '@/lib/reviewTarget';

// Mirrors github.com's own paths, so pasting a pull request URL into reviewer
// needs nothing more than a host swap.
export default async function GitHubReviewPage({
  params,
}: {
  params: Promise<{ segments: string[] }>;
}) {
  const { segments } = await params;
  const target = gitHubTargetFromSegments(segments);
  if (target == null) {
    notFound();
  }
  return <ReviewScreen target={target} />;
}
