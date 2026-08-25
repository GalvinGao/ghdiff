'use client';

import { PullRow } from '@/components/PullRow';
import { SectionLabel } from '@/components/ui/SectionLabel';
import type { PullSwitcherState } from '@/hooks/usePullSwitcher';
import { formatWatchedRepo, type WatchedRepo } from '@/lib/pullSwitcher';
import type { GitHubPullTarget } from '@/lib/reviewTarget';

interface PullRequestListProps {
  /** The pull request under review, which the list marks. */
  current?: GitHubPullTarget;
  onNavigate?(): void;
  repos: readonly WatchedRepo[];
  state: PullSwitcherState;
  viewerLogin?: string;
}

/**
 * Open pull requests for the watched repositories, split into the two review
 * jobs: the ones the viewer opened, so self review after an agent pushed, and
 * everybody else's. The header shows this in a menu and the home page shows it
 * on the page, and neither owns the loading, empty, and failure states.
 */
export function PullRequestList({
  current,
  onNavigate,
  repos,
  state,
  viewerLogin,
}: PullRequestListProps) {
  const { data, error, loading } = state;

  if (repos.length === 0) {
    return (
      <p className="text-ink-muted px-2 py-3 text-sm">
        Add a repository to watch. Reviewer then lists its open pull requests
        here.
      </p>
    );
  }
  if (loading && data == null) {
    return <p className="text-ink-muted px-2 py-3 text-sm">Loading…</p>;
  }
  if (error != null) {
    return <p className="text-removed px-2 py-3 text-sm">{error}</p>;
  }
  if (data == null || data.groups.length === 0) {
    return (
      <p className="text-ink-muted px-2 py-3 text-sm">
        No open pull requests in {repos.map(formatWatchedRepo).join(', ')}.
      </p>
    );
  }

  return (
    <>
      {data.groups.map((group) => (
        // The gap belongs between the groups. On the last one it would be a
        // second bottom padding under the menu's own.
        <div key={group.kind} className="pb-1 last:pb-0">
          <div className="flex items-baseline gap-2 px-2 pt-2 pb-1">
            <SectionLabel>
              {group.kind === 'yours' ? 'Yours — self review' : 'Others'}
            </SectionLabel>
            <span className="text-ink-faint ml-auto text-xs tabular-nums">
              {group.count}
            </span>
          </div>
          {group.authors.map((author) => (
            <div key={author.author}>
              {group.kind === 'others' && (
                <p className="text-ink-muted px-2 pt-1 pb-0.5 text-xs">
                  {author.author}
                </p>
              )}
              {author.pulls.map((pull) => (
                <PullRow
                  key={`${pull.owner}/${pull.repo}#${pull.number}`}
                  current={current}
                  pull={pull}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          ))}
        </div>
      ))}

      {data.failures.length > 0 && (
        <div className="border-line mt-1 border-t pt-1">
          {data.failures.map((failure) => (
            <p key={failure.repo} className="text-removed px-2 py-1 text-xs">
              {failure.repo}: {failure.message}
            </p>
          ))}
        </div>
      )}

      {viewerLogin == null && (
        <p className="text-ink-faint border-line mt-1 border-t px-2 py-1.5 text-xs">
          Add a GitHub token to separate your own pull requests from the rest.
        </p>
      )}
    </>
  );
}
