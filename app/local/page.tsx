import { notFound } from 'next/navigation';

import { ReviewScreen } from '@/components/ReviewScreen';
import { LOCAL_HEAD_WORKTREE, type ReviewTarget } from '@/lib/reviewTarget';

// A diff between two refs in a git repository on this machine.
export default async function LocalReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const repoPath = first(params.repo);
  const base = first(params.base);
  if (repoPath == null || base == null) {
    notFound();
  }

  const target: ReviewTarget = {
    kind: 'local',
    repoPath,
    base,
    head: first(params.head) ?? LOCAL_HEAD_WORKTREE,
  };
  return <ReviewScreen target={target} />;
}

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
