import { GitMergeIcon } from '@primer/octicons-react/GitMergeIcon';
import { GitPullRequestClosedIcon } from '@primer/octicons-react/GitPullRequestClosedIcon';
import { GitPullRequestDraftIcon } from '@primer/octicons-react/GitPullRequestDraftIcon';
import { GitPullRequestIcon } from '@primer/octicons-react/GitPullRequestIcon';

import { cn } from '@/lib/cn';
import type { PullState } from '@/lib/pulls';

// The official octicons, imported one file at a time so only these four reach
// the bundle. Colors are GitHub's own Primer state tokens, defined per scheme in
// globals.css, so a state reads the same here as it does on github.com.

const ICON = {
  open: GitPullRequestIcon,
  draft: GitPullRequestDraftIcon,
  merged: GitMergeIcon,
  closed: GitPullRequestClosedIcon,
} as const;

const COLOR: Record<PullState, string> = {
  open: 'text-pr-open',
  draft: 'text-pr-draft',
  merged: 'text-pr-merged',
  closed: 'text-pr-closed',
};

const LABEL: Record<PullState, string> = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
};

export function PullStateIcon({
  className,
  state,
}: {
  className?: string;
  state: PullState;
}) {
  const Icon = ICON[state];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center',
        COLOR[state],
        className
      )}
      title={LABEL[state]}
      aria-label={LABEL[state]}
      role="img"
    >
      <Icon size={16} />
    </span>
  );
}

export function pullStateLabel(state: PullState): string {
  return LABEL[state];
}
