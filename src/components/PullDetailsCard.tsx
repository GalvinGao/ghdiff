import { IconShare } from '@pierre/icons';

import { CommentBody } from '@/components/CommentBody';
import { PullStateIcon, pullStateLabel } from '@/components/PullStateIcon';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { describeAge, type PullDetails } from '@/lib/pullDetails';

// What the pull request is for, which the diff cannot say. It is a card behind
// the title rather than a panel in the layout: it is read once at the start of a
// review, and it must not take width from the code for the rest of it.

export function PullDetailsCard({
  details,
  error,
  loading,
  now,
}: {
  details?: PullDetails;
  error?: string;
  loading: boolean;
  /**
   * The instant the ages are measured from, stamped by whoever opened the card.
   * Null until then: reading a clock while rendering is not this component's to
   * do, and an age is worth nothing without the moment it was taken.
   */
  now: number | null;
}) {
  if (details == null) {
    return (
      <p
        className={
          error != null
            ? 'text-removed p-3 text-sm'
            : 'text-ink-muted p-3 text-sm'
        }
      >
        {error ?? (loading ? 'Loading pull request…' : 'No details yet.')}
      </p>
    );
  }

  return (
    <div className="min-w-0 p-3">
      <div className="flex items-center gap-2">
        <PullStateIcon state={details.state} />
        <span className="text-ink text-xs font-medium">
          {pullStateLabel(details.state)}
        </span>
        {now != null && (
          <span className="text-ink-faint text-xs">
            opened {describeAge(details.createdAt, now)}
          </span>
        )}
        <a
          className="text-ink-faint hover:text-ink ml-auto inline-flex items-center gap-1 text-xs"
          href={details.htmlUrl}
          rel="noreferrer"
          target="_blank"
        >
          GitHub
          <IconShare size={12} />
        </a>
      </div>

      <h2 className="text-ink mt-2 text-sm leading-snug font-semibold text-pretty">
        {details.title}
      </h2>

      <div className="text-ink-muted mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {details.authorAvatarUrl != null && (
          <img
            alt=""
            className="size-4 rounded-full"
            height={16}
            loading="lazy"
            src={details.authorAvatarUrl}
            width={16}
          />
        )}
        <span className="text-ink">{details.author}</span>
        <span className="text-ink-faint">·</span>
        <span className="min-w-0 truncate font-mono text-[11px]">
          {details.headRef} → {details.baseRef}
        </span>
      </div>

      <dl className="text-ink-muted mt-2 flex flex-wrap items-baseline gap-x-3 text-xs tabular-nums">
        {details.changedFiles != null && (
          <div className="flex gap-1">
            <dt className="sr-only">Files</dt>
            <dd>{details.changedFiles} files</dd>
          </div>
        )}
        {details.additions != null && (
          <div className="flex gap-1">
            <dt className="sr-only">Added lines</dt>
            <dd className="text-added">+{details.additions}</dd>
          </div>
        )}
        {details.deletions != null && (
          <div className="flex gap-1">
            <dt className="sr-only">Deleted lines</dt>
            <dd className="text-removed">-{details.deletions}</dd>
          </div>
        )}
        {details.commits != null && (
          <div className="flex gap-1">
            <dt className="sr-only">Commits</dt>
            <dd>
              {details.commits} {details.commits === 1 ? 'commit' : 'commits'}
            </dd>
          </div>
        )}
        {now != null && (
          <span className="text-ink-faint ml-auto">
            updated {describeAge(details.updatedAt, now)}
          </span>
        )}
      </dl>

      {details.body != null && (
        <>
          <div className="border-line mt-3 border-t pt-2">
            <SectionLabel>Description</SectionLabel>
          </div>
          {/* A description can be a whole essay. It scrolls inside the card so
              the card keeps the size the header can afford. */}
          <div className="cv-scrollbar text-ink-muted mt-1 max-h-64 overflow-y-auto overscroll-contain">
            <CommentBody body={details.body} />
          </div>
        </>
      )}
    </div>
  );
}
