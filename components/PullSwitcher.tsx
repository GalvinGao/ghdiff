'use client';

import Link from 'next/link';
import { useState } from 'react';

import { WatchedReposEditor } from './WatchedReposEditor';
import { Button } from '@/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { usePullSwitcher } from '@/hooks/usePullSwitcher';
import type { WatchedReposState } from '@/hooks/useWatchedRepos';
import { cn } from '@/lib/cn';
import { formatWatchedRepo, type PullSummary } from '@/lib/pullSwitcher';
import { reviewTargetHref } from '@/lib/reviewTarget';

interface PullSwitcherProps {
  /** Shown on the trigger. The current review, or a prompt on the home page. */
  label: string;
  token?: string;
  viewerLogin?: string;
  watched: WatchedReposState;
}

/**
 * The top-left picker. It lists open pull requests for the watched
 * repositories, split into the two review jobs: the ones the viewer opened, so
 * self review after an agent pushed, and everybody else.
 */
export function PullSwitcher({
  label,
  token,
  viewerLogin,
  watched,
}: PullSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const { data, error, loading, reload } = usePullSwitcher({
    active: open,
    repos: watched.repos,
    token,
  });

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setEditing(false);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="md" className="max-w-[22rem] gap-2">
          <span className="truncate font-medium">{label}</span>
          <ChevronGlyph />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[26rem]">
        {editing ? (
          <WatchedReposEditor
            watched={watched}
            onDone={() => {
              setEditing(false);
              reload();
            }}
          />
        ) : (
          <>
            <div className="flex items-center gap-2 px-2 pt-1.5">
              <span className="text-ink-faint text-[11px] font-semibold tracking-wide uppercase">
                Open pull requests
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => setEditing(true)}
              >
                Watched repos
              </Button>
            </div>

            {watched.repos.length === 0 ? (
              <p className="text-ink-muted px-2 py-3 text-sm">
                Add a repository to watch. Reviewer then lists its open pull
                requests here.
              </p>
            ) : loading && data == null ? (
              <p className="text-ink-muted px-2 py-3 text-sm">Loading…</p>
            ) : error != null ? (
              <p className="text-removed px-2 py-3 text-sm">{error}</p>
            ) : data == null || data.groups.length === 0 ? (
              <p className="text-ink-muted px-2 py-3 text-sm">
                No open pull requests in{' '}
                {watched.repos.map(formatWatchedRepo).join(', ')}.
              </p>
            ) : (
              data.groups.map((group) => (
                <div key={group.kind}>
                  <DropdownMenuLabel className="flex items-baseline gap-2">
                    <span>
                      {group.kind === 'yours'
                        ? 'Yours — self review'
                        : 'Others'}
                    </span>
                    <span className="ml-auto tabular-nums">{group.count}</span>
                  </DropdownMenuLabel>
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
                          pull={pull}
                          onNavigate={() => setOpen(false)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ))
            )}

            {data != null && data.failures.length > 0 && (
              <>
                <DropdownMenuSeparator />
                {data.failures.map((failure) => (
                  <p
                    key={failure.repo}
                    className="text-removed px-2 py-1 text-xs"
                  >
                    {failure.repo}: {failure.message}
                  </p>
                ))}
              </>
            )}

            {viewerLogin == null && watched.repos.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <p className="text-ink-faint px-2 py-1.5 text-xs">
                  Add a GitHub token to separate your own pull requests from the
                  rest.
                </p>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PullRow({
  onNavigate,
  pull,
}: {
  onNavigate(): void;
  pull: PullSummary;
}) {
  return (
    <Link
      href={reviewTargetHref({
        kind: 'github-pull',
        owner: pull.owner,
        repo: pull.repo,
        number: pull.number,
      })}
      onClick={onNavigate}
      className={cn(
        'hover:bg-surface block rounded-md px-2 py-1.5 text-sm outline-none',
        'focus-visible:bg-surface'
      )}
    >
      <span className="flex items-baseline gap-2">
        <span className="text-ink-faint font-mono text-xs tabular-nums">
          #{pull.number}
        </span>
        <span className="text-ink min-w-0 flex-1 truncate">{pull.title}</span>
        {pull.draft && (
          <span className="text-ink-faint text-[11px] uppercase">draft</span>
        )}
      </span>
      <span className="text-ink-faint block truncate text-xs">
        {pull.owner}/{pull.repo} · {pull.headRef} into {pull.baseRef}
      </span>
    </Link>
  );
}

function ChevronGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="ml-auto size-3 shrink-0 fill-none stroke-current stroke-[1.6]"
    >
      <path d="M4 6.5 8 10.5l4-4" strokeLinecap="round" />
    </svg>
  );
}
