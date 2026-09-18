import { useNavigate } from '@tanstack/react-router';

import { Button } from '@/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import type { usePullCommits } from '@/hooks/usePullCommits';
import { commitNeighbors, reviewedCommitCount } from '@/lib/pullCommits';
import { type GitHubPullTarget, reviewTargetSplat } from '@/lib/reviewTarget';

export function PullCommitNavigation({
  target,
  commits,
}: {
  target: GitHubPullTarget;
  commits: ReturnType<typeof usePullCommits>;
}) {
  const navigate = useNavigate();
  const rows = commits.data?.commits ?? [];
  const { index, previous, next } = commitNeighbors(rows, target.commitSha);
  const current = rows[index];
  const go = (sha?: string) =>
    void navigate({
      to: '/$',
      params: { _splat: reviewTargetSplat({ ...target, commitSha: sha }) },
      hash: '',
      resetScroll: false,
    });
  const done = current != null && commits.reviewed.has(current.sha);
  return (
    <nav
      aria-label="Commit review"
      className="border-line bg-surface shrink-0 border-b px-3 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="max-w-full min-w-0 max-sm:w-full"
              aria-label="Choose commit"
            >
              <span className="truncate">
                {target.commitSha == null
                  ? 'All changes'
                  : `${target.commitSha.slice(0, 7)} ${current?.message.split('\n')[0] ?? ''}`}
              </span>
              <span aria-hidden="true">▾</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-[min(36rem,calc(100vw-24px))]"
          >
            <DropdownMenuItem onSelect={() => go()}>
              All changes{target.commitSha == null ? ' ✓' : ''}
            </DropdownMenuItem>
            {rows.map((commit, row) => (
              <DropdownMenuItem
                key={commit.sha}
                onSelect={() => go(commit.sha)}
                textValue={commit.message}
                aria-current={
                  commit.sha === target.commitSha ? 'true' : undefined
                }
              >
                <span
                  className="w-5 shrink-0 text-xs"
                  aria-label={
                    commits.reviewed.has(commit.sha)
                      ? 'Reviewed'
                      : 'Not reviewed'
                  }
                >
                  {commits.reviewed.has(commit.sha) ? '✓' : row + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate">
                    {commit.message.split('\n')[0]}
                  </span>
                  <span className="text-ink-faint block truncate text-xs">
                    <span className="font-mono">{commit.sha.slice(0, 7)}</span>{' '}
                    · {commit.author}
                    {commit.date == null
                      ? ''
                      : ` · ${commit.date.slice(0, 10)}`}
                    {commit.parents.length > 1 ? ' · Merge' : ''}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {target.commitSha != null && (
          <>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="chrome"
                size="sm"
                disabled={previous == null}
                onClick={() => go(previous?.sha)}
              >
                Previous
              </Button>
              <span className="text-ink-muted text-xs tabular-nums">
                {index < 0 ? '—' : index + 1} / {commits.data?.total ?? '—'}
              </span>
              <Button
                variant="chrome"
                size="sm"
                disabled={next == null}
                onClick={() => go(next?.sha)}
              >
                Next
              </Button>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={current == null}
                aria-pressed={done}
                onClick={() =>
                  current != null && commits.mark(current.sha, !done)
                }
              >
                {done ? '✓ Reviewed' : 'Reviewed'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={current == null}
                onClick={() => {
                  if (current == null) return;
                  commits.mark(current.sha, true);
                  if (next != null) go(next.sha);
                }}
              >
                {next == null ? 'Done' : 'Done and next'}
              </Button>
            </div>
          </>
        )}
        <span className="text-ink-faint ml-auto text-xs tabular-nums">
          {reviewedCommitCount(rows, commits.reviewed)} /{' '}
          {commits.data?.total ?? '—'} reviewed · this browser
        </span>
        <Button
          variant="chrome"
          size="sm"
          disabled={commits.loading}
          onClick={() => void commits.reload()}
        >
          {commits.loading ? 'Loading commits…' : 'Refresh commits'}
        </Button>
      </div>
      {current?.parents.length != null && current.parents.length > 1 && (
        <p className="text-ink-faint mt-1 text-xs">
          Merge commit · changes against its first parent{' '}
          {current.parents[0].slice(0, 7)}
        </p>
      )}
      {commits.data?.truncated && (
        <p className="text-ink-muted mt-1 text-xs">
          The commit list is incomplete. GitHub lists at most 250 commits. All
          changes still shows the whole PR.
        </p>
      )}
      {commits.error != null && (
        <p role="alert" className="text-removed mt-1 text-xs">
          {commits.error}
        </p>
      )}
    </nav>
  );
}
