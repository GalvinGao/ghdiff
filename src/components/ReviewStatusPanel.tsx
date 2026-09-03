import { IconCiWarningFill, IconRefresh } from '@pierre/icons';
import { Link } from '@tanstack/react-router';

import { Button } from '@/components/ui/Button';
import { buttonClass } from '@/components/ui/buttonClass';
import type { GitHubSessionState } from '@/hooks/useGitHubSession';
import { formatBytes } from '@/lib/byteSize';
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
    message: 'Background workers are getting ready to color your code.',
  },
};

/**
 * What fills the review pane before the diff can. It says which of the three
 * waits is happening, because they fail for different reasons, and it offers a
 * button rather than a line of underlined text when one of them breaks.
 *
 * Which button it leads with is `describeReviewFailure`'s answer, and there are
 * two. Anything a reviewer can fix by granting something leads to `/setup`, which
 * is the one screen that asks GitHub whether the missing piece is the sign-in or
 * the installation. Everything else keeps "Try again" as the only offer worth
 * making.
 */
export function ReviewStatusPanel({
  bytes,
  error,
  onRetry,
  session,
  state,
  status,
  target,
  targetPath,
}: {
  /** Patch bytes read so far, while the patch is still arriving. */
  bytes?: number;
  error?: string;
  onRetry(): void;
  session: GitHubSessionState;
  state: ReviewLoadState;
  /** Where the reviewer is, so the setup page knows which account to name. */
  targetPath: string;
  /** The status the diff request failed with, when it failed with one. */
  status?: number;
  target: ReviewTarget;
}) {
  const isError = state === 'error';
  const failure = describeReviewFailure({
    signedIn: session.signedIn,
    message: error,
    status,
  });

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
        {/* What has arrived, while it is still arriving. A count and not a
            percentage, because nothing on the wire states a total: the diff
            host answers chunked. `tabular-nums`, or a figure that climbs
            through 9.9 MB to 10.0 MB shifts every digit beside it, and a
            number that jitters reads as the page redrawing rather than as
            the download moving. */}
        {!isError && bytes != null && (
          <p className="text-ink-muted mt-1 text-sm tabular-nums">
            {formatBytes(bytes)} read
          </p>
        )}
        <p className="text-ink-faint mt-3 truncate font-mono text-xs">
          {describeReviewTarget(target)}
        </p>
        {isError && (
          <div className="mt-4 flex items-center justify-center gap-2">
            {/* One button for both of the things that can be missing, because
                the page it opens is the one that can tell them apart — it asks
                GitHub which, rather than guessing from a status code. `from`
                carries the path so that page can name the account, and step
                three there leads straight back here. */}
            {failure.action === 'setup' && (
              <Link
                className={buttonClass({ variant: 'solid' })}
                search={{
                  account: undefined,
                  from: targetPath,
                  migrated: undefined,
                }}
                to="/setup"
              >
                Set up repository access
              </Link>
            )}
            <Button variant="outline" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
