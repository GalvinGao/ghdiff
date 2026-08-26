import { IconCiWarningFill, IconRefresh } from '@pierre/icons';
import { useEffect, useState } from 'react';

import { GitHubTokenForm } from '@/components/GitHubTokenForm';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import type { GitHubTokenState } from '@/hooks/useGitHubToken';
import { describeReviewFailure } from '@/lib/reviewFailure';
import { describeReviewTarget, type ReviewTarget } from '@/lib/reviewTarget';

export type ReviewLoadState = 'fetching' | 'parsing' | 'starting' | 'error';

const COPY: Record<
  Exclude<ReviewLoadState, 'error'>,
  { title: string; message: string }
> = {
  fetching: {
    title: 'Fetching the diff',
    message: 'Reading the patch for this review.',
  },
  parsing: {
    title: 'Preparing the diff',
    message: 'Parsing the patch and building the file list.',
  },
  starting: {
    title: 'Starting the highlighters',
    message: 'Warming the workers that colour the code.',
  },
};

/**
 * What fills the review pane before the diff can. It says which of the three
 * waits is happening, because they fail for different reasons, and it offers a
 * button rather than a line of underlined text when one of them breaks.
 *
 * Which button it leads with is `describeReviewFailure`'s answer. A rate limit
 * with no token, and a Not Found either way, are the failures "Try again"
 * cannot mend, so those panels ask for a token instead and keep the retry as
 * the second control on the row.
 */
export function ReviewStatusPanel({
  error,
  onRetry,
  state,
  status,
  target,
  token,
}: {
  error?: string;
  onRetry(): void;
  state: ReviewLoadState;
  /** The status the diff request failed with, when it failed with one. */
  status?: number;
  target: ReviewTarget;
  token: GitHubTokenState;
}) {
  const isError = state === 'error';
  const [asking, setAsking] = useState(false);
  const failure = describeReviewFailure({
    hasToken: token.hasToken,
    message: error,
    status,
  });

  // A token GitHub answers for is the end of this errand, and the diff is
  // already reloading behind the dialog: `useReviewPatch` depends on the token,
  // so saving one starts the request that this panel was standing in for. A
  // token GitHub rejects leaves the dialog open, with the reason inside it.
  useEffect(() => {
    if (asking && token.viewer != null) setAsking(false);
  }, [asking, token.viewer]);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <section
        aria-busy={isError ? undefined : true}
        aria-live="polite"
        role={isError ? 'alert' : 'status'}
        className="max-w-md text-center"
      >
        {isError ? (
          <IconCiWarningFill
            aria-hidden="true"
            className="text-removed mx-auto mb-3"
            size={20}
          />
        ) : (
          <IconRefresh
            aria-hidden="true"
            className="text-ink-faint mx-auto mb-3 -scale-x-100 animate-spin [animation-direction:reverse] [animation-duration:1.2s] motion-reduce:animate-none"
            size={20}
          />
        )}
        <h2 className="text-ink text-sm font-medium">
          {isError ? failure.title : COPY[state].title}
        </h2>
        <p className="text-ink-muted mt-1 text-sm text-pretty">
          {isError ? failure.message : COPY[state].message}
        </p>
        <p className="text-ink-faint mt-3 truncate font-mono text-xs">
          {describeReviewTarget(target)}
        </p>
        {isError && (
          <div className="mt-4 flex items-center justify-center gap-2">
            {failure.action === 'add-token' && (
              // The same dialog either way, and the word for what it is about
              // to do. A reviewer a 404 sends here usually has a token already
              // — one that cannot reach this repository — and `Add token`
              // would read as an offer they had taken up.
              <Button variant="solid" onClick={() => setAsking(true)}>
                {token.hasToken ? 'Change token' : 'Add token'}
              </Button>
            )}
            <Button variant="outline" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
      </section>

      <Dialog
        onClose={() => setAsking(false)}
        open={asking}
        title="GitHub token"
      >
        <GitHubTokenForm token={token} />
      </Dialog>
    </div>
  );
}
