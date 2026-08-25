import {
  IconReload,
  IconSidebarLeft,
  IconSidebarLeftOpen,
} from '@pierre/icons';
import { Link, useLocation } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { useAppData } from '@/components/AppDataProvider';
import { PullRequestList } from '@/components/PullRequestList';
import { isCurrentPull } from '@/components/PullRow';
import { PullStatusMark } from '@/components/PullStatusMark';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { WatchedReposDialog } from '@/components/WatchedReposDialog';
import { useStoredJson } from '@/hooks/useLocalStorage';
import { cn } from '@/lib/cn';
import { flattenStacks, groupPullsByRepo, type PullSummary } from '@/lib/pulls';
import {
  type GitHubPullTarget,
  gitHubTargetFromSegments,
  reviewTargetSplat,
} from '@/lib/reviewTarget';
import { RAIL_COLLAPSED_STORAGE_KEY } from '@/lib/storageKeys';

// The left-most bar, on every page. Reviewing is moving between pull requests,
// so the list of them is not a menu the reviewer opens: it is the edge of the
// app, and the diff sits inside it.
//
// The bar reads the pull request on screen out of the path rather than being
// told, so it works the same above the home page, a review, and a 404.

const EXPANDED_WIDTH = '17rem';
const COLLAPSED_WIDTH = '2.75rem';

export function PullRail() {
  const { pulls, watched } = useAppData();
  const [editing, setEditing] = useState(false);
  const { value: collapsed, setValue: setCollapsed } = useStoredJson(
    RAIL_COLLAPSED_STORAGE_KEY,
    false
  );
  const current = useCurrentPull();

  return (
    <>
      <aside
        aria-label="Open pull requests"
        className="border-line bg-surface flex h-full shrink-0 flex-col border-r"
        style={{ width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
      >
        <div
          className={cn(
            'border-line flex h-11 shrink-0 items-center border-b',
            collapsed ? 'justify-center px-1' : 'gap-1 px-2'
          )}
        >
          {!collapsed && (
            <Link
              to="/"
              className="text-ink-faint hover:text-ink min-w-0 truncate px-1 text-xs font-semibold tracking-wide uppercase"
            >
              reviewer
            </Link>
          )}
          <Button
            aria-label={
              collapsed ? 'Show the pull requests' : 'Hide the pull requests'
            }
            className={collapsed ? undefined : 'ml-auto'}
            size="icon-sm"
            title={
              collapsed ? 'Show the pull requests' : 'Hide the pull requests'
            }
            variant="chrome"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <IconSidebarLeftOpen size={15} />
            ) : (
              <IconSidebarLeft size={15} />
            )}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {collapsed ? (
            <CollapsedMarks current={current} />
          ) : (
            <div className="px-1 pb-2">
              <PullRequestList
                current={current}
                repos={watched.repos}
                state={pulls}
              />
            </div>
          )}
        </div>

        {!collapsed && (
          <div className="border-line flex shrink-0 items-center gap-1 border-t p-1">
            <Button
              className="min-w-0"
              size="sm"
              variant="chrome"
              onClick={() => setEditing(true)}
            >
              <span className="truncate">Watched repos</span>
            </Button>
            <Button
              aria-label="Reload the pull requests"
              className="ml-auto"
              disabled={pulls.loading}
              size="icon-sm"
              title="Reload the pull requests"
              variant="chrome"
              onClick={pulls.reload}
            >
              {/* `Spinner` is the app's one turning glyph, so a reload that is
                  under way looks the same here as beside a list. */}
              {pulls.loading ? (
                <Spinner label="Loading the pull requests" size={14} />
              ) : (
                <IconReload size={14} />
              )}
            </Button>
          </div>
        )}
      </aside>

      <WatchedReposDialog
        open={editing}
        watched={watched}
        onClose={() => {
          setEditing(false);
          pulls.reload();
        }}
      />
    </>
  );
}

/**
 * The collapsed bar. Every open pull request keeps its square, in the same
 * order, so the column still answers the question the bar exists for: is
 * anything red.
 */
function CollapsedMarks({ current }: { current?: GitHubPullTarget }) {
  const { pulls } = useAppData();
  const ordered = useMemo<PullSummary[]>(() => {
    if (pulls.data == null) return [];
    return groupPullsByRepo(pulls.data.pulls, pulls.data.viewer).flatMap(
      (group) =>
        group.authors.flatMap((author) =>
          flattenStacks(author.stacks).map((node) => node.pull)
        )
    );
  }, [pulls.data]);

  return (
    <div className="flex flex-col items-center gap-1 py-2">
      {ordered.map((pull) => {
        const isCurrent = isCurrentPull(pull, current);
        const label = `${pull.owner}/${pull.repo} #${pull.number} — ${pull.title}`;
        return (
          <Link
            key={`${pull.owner}/${pull.repo}#${pull.number}`}
            to="/gh/$"
            params={{
              _splat: reviewTargetSplat({
                kind: 'github-pull',
                owner: pull.owner,
                repo: pull.repo,
                number: pull.number,
              }),
            }}
            aria-current={isCurrent ? 'page' : undefined}
            aria-label={label}
            className={cn(
              'flex size-7 items-center justify-center rounded-md outline-none',
              'hover:bg-raised focus-visible:bg-raised',
              isCurrent && 'ring-accent bg-raised ring-2'
            )}
            title={label}
          >
            {pull.status == null ? (
              <span className="bg-status-neutral size-2 rounded-full" />
            ) : (
              <PullStatusMark status={pull.status} />
            )}
          </Link>
        );
      })}
    </div>
  );
}

/** The pull request the path names, if the path names one. */
function useCurrentPull(): GitHubPullTarget | undefined {
  // The bar sits above every route, so it reads the path rather than a route's
  // params. `useLocation` re-renders it on each navigation.
  const pathname = useLocation({ select: (location) => location.pathname });
  return useMemo(() => {
    const segments = pathname.split('/').filter((part) => part.length > 0);
    if (segments[0] !== 'gh') return undefined;
    const target = gitHubTargetFromSegments(segments.slice(1));
    return target?.kind === 'github-pull' ? target : undefined;
  }, [pathname]);
}
