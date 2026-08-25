'use client';

import { IconChevronSm } from '@pierre/icons';
import { useRef, useState } from 'react';

import { PullRequestList } from '@/components/PullRequestList';
import { Button } from '@/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { Spinner } from '@/components/ui/Spinner';
import { WatchedReposDialog } from '@/components/WatchedReposDialog';
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
  // Read by the menu's own focus handler, which runs while it closes, so it
  // cannot wait for a re-render to learn where the focus should be going.
  const openingDialogRef = useRef(false);
  const state = usePullSwitcher({
    active: open,
    repos: watched.repos,
    token,
  });

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
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
        <DropdownMenuContent
          align="start"
          className="w-[26rem]"
          // The dialog takes the focus when it opens. Without this the menu
          // hands it back to the trigger on the way out, and the reviewer types
          // into nothing.
          onCloseAutoFocus={(event) => {
            if (openingDialogRef.current) {
              openingDialogRef.current = false;
              event.preventDefault();
            }
          }}
        >
          <div className="flex items-center gap-2 px-2 pt-1.5">
            <SectionLabel>Open pull requests</SectionLabel>
            {/* The menu asks GitHub again on every open, so the list on screen
                is the one from last time until the answer lands. */}
            {state.loading && <Spinner label="Loading the pull requests" />}
            <Button
              size="sm"
              variant="quiet"
              className="ml-auto"
              onClick={() => {
                openingDialogRef.current = true;
                setEditing(true);
                setOpen(false);
              }}
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
        </DropdownMenuContent>
      </DropdownMenu>

      <WatchedReposDialog
        open={editing}
        watched={watched}
        onClose={() => {
          setEditing(false);
          state.reload();
        }}
      />
    </>
  );
}
