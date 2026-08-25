'use client';

import { IconChevronSm } from '@pierre/icons';
import { useState } from 'react';

import { WatchedReposEditor } from './WatchedReposEditor';
import { PullRequestList } from '@/components/PullRequestList';
import { Button } from '@/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { usePullSwitcher } from '@/hooks/usePullSwitcher';
import type { WatchedReposState } from '@/hooks/useWatchedRepos';
import { cn } from '@/lib/cn';
import type { GitHubPullTarget } from '@/lib/reviewTarget';

interface PullSwitcherProps {
  /** The pull request under review, which the list marks. */
  current?: GitHubPullTarget;
  /** Shown on the trigger: the review that is open. */
  label: string;
  token?: string;
  viewerLogin?: string;
  watched: WatchedReposState;
}

/**
 * The header's picker. It moves between the open pull requests of the watched
 * repositories without going back to the home page.
 */
export function PullSwitcher({
  current,
  label,
  token,
  viewerLogin,
  watched,
}: PullSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const state = usePullSwitcher({
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
        <Button variant="chrome" size="sm" className="max-w-[18rem] gap-1.5">
          <span className="text-ink truncate font-medium">{label}</span>
          <IconChevronSm
            className={cn(
              'ml-auto shrink-0 transition-transform',
              open && 'rotate-180'
            )}
            size={12}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[26rem]">
        {editing ? (
          <WatchedReposEditor
            watched={watched}
            onDone={() => {
              setEditing(false);
              state.reload();
            }}
          />
        ) : (
          <>
            <div className="flex items-center gap-2 px-2 pt-1.5">
              <SectionLabel>Open pull requests</SectionLabel>
              <Button
                size="sm"
                variant="quiet"
                className="ml-auto"
                onClick={() => setEditing(true)}
              >
                Watched repos
              </Button>
            </div>
            <PullRequestList
              current={current}
              repos={watched.repos}
              state={state}
              viewerLogin={viewerLogin}
              onNavigate={() => setOpen(false)}
            />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
