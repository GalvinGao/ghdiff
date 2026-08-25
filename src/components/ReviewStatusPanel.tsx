import { IconCiWarningFill, IconRefresh } from '@pierre/icons';

import { Button } from '@/components/ui/Button';
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
 */
export function ReviewStatusPanel({
  error,
  onRetry,
  state,
  target,
}: {
  error?: string;
  onRetry(): void;
  state: ReviewLoadState;
  target: ReviewTarget;
}) {
  const isError = state === 'error';
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
          {isError ? 'Could not load that diff' : COPY[state].title}
        </h2>
        <p className="text-ink-muted mt-1 text-sm text-pretty">
          {isError
            ? (error ?? 'The request for this diff did not come back.')
            : COPY[state].message}
        </p>
        <p className="text-ink-faint mt-3 truncate font-mono text-xs">
          {describeReviewTarget(target)}
        </p>
        {isError && (
          <Button className="mt-4" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )}
      </section>
    </div>
  );
}
