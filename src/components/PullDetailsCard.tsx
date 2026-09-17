import { IconShare } from '@pierre/icons';

import { m } from '../paraglide/messages.js';
import { CommentBody } from '@/components/CommentBody';
import { PullStateIcon, pullStateLabel } from '@/components/PullStateIcon';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { formatNumber } from '@/lib/locale';
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
        {error ??
          (loading
            ? m.pull_details_card_loading_pull_request()
            : m.pull_details_card_no_details_yet())}
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
            {m.pull_opened_age({ age: describeAge(details.createdAt, now) })}
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
        <span className="min-w-0 truncate font-mono text-[11px]" dir="ltr">
          {details.headRef} → {details.baseRef}
        </span>
      </div>

      <dl className="text-ink-muted mt-2 flex flex-wrap items-baseline gap-x-3 text-xs tabular-nums">
        {details.changedFiles != null && (
          <div className="flex gap-1">
            <dt className="sr-only">{m.pull_details_card_files()}</dt>
            <dd>{m.common_file_count({ count: details.changedFiles })}</dd>
          </div>
        )}
        {details.additions != null && (
          <div className="flex gap-1">
            <dt className="sr-only">{m.pull_details_card_added_lines()}</dt>
            <dd className="text-added" dir="ltr">
              +{formatNumber(details.additions)}
            </dd>
          </div>
        )}
        {details.deletions != null && (
          <div className="flex gap-1">
            <dt className="sr-only">{m.pull_details_card_deleted_lines()}</dt>
            <dd className="text-removed" dir="ltr">
              -{formatNumber(details.deletions)}
            </dd>
          </div>
        )}
        {details.commits != null && (
          <div className="flex gap-1">
            <dt className="sr-only">{m.pull_details_card_commits()}</dt>
            <dd>{m.common_commit_count({ count: details.commits })}</dd>
          </div>
        )}
        {now != null && (
          <span className="text-ink-faint ml-auto">
            {m.pull_updated_age({ age: describeAge(details.updatedAt, now) })}
          </span>
        )}
      </dl>

      {details.body != null && (
        <>
          <div className="border-line mt-3 border-t pt-2">
            <SectionLabel>{m.pull_details_card_description()}</SectionLabel>
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
