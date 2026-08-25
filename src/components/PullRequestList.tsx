import { type CSSProperties, useMemo } from 'react';

import { PullRow } from '@/components/PullRow';
import { PullStackBadge } from '@/components/PullStackBadge';
import { SectionLabel } from '@/components/ui/SectionLabel';
import type { OpenPullsState } from '@/hooks/useOpenPulls';
import { cn } from '@/lib/cn';
import {
  formatWatchedRepo,
  groupPullsByRepo,
  type PullStackNode,
  type WatchedRepo,
} from '@/lib/pulls';
import { countStackNodes } from '@/lib/pullStacks';
import type { GitHubPullTarget } from '@/lib/reviewTarget';

interface PullRequestListProps {
  /** The pull request under review, which the list marks. */
  current?: GitHubPullTarget;
  /** Whether `repos` is the stored watch list yet, or still the empty default. */
  hydrated: boolean;
  onNavigate?(): void;
  /** One `owner/repo`, or undefined for every watched repository. */
  repoFilter?: string;
  repos: readonly WatchedRepo[];
  /** False when the caller has already named the repository above the list. */
  showRepoHeadings?: boolean;
  state: OpenPullsState;
}

/**
 * Open pull requests, in the order a reviewer reads them: which repository, then
 * who wrote them, then which stack they belong to. Anything still level with
 * something else goes by pull request number, newest first.
 *
 * The left bar and the home page both render this, and neither owns the loading,
 * empty, and failure states.
 */
export function PullRequestList({
  current,
  hydrated,
  onNavigate,
  repoFilter,
  repos,
  showRepoHeadings = true,
  state,
}: PullRequestListProps) {
  const { data, error, loading } = state;

  const groups = useMemo(() => {
    if (data == null) return [];
    const pulls =
      repoFilter == null
        ? data.pulls
        : data.pulls.filter(
            (pull) =>
              formatWatchedRepo(pull).toLowerCase() === repoFilter.toLowerCase()
          );
    return groupPullsByRepo(pulls, data.viewer);
  }, [data, repoFilter]);

  const failures = data?.failures ?? [];

  return (
    <>
      {!hydrated ? (
        // The watch list is read from browser storage after mount, so until it
        // arrives an empty `repos` is the default and not an answer. Saying
        // "watch a repository" here told every reviewer who watches five that
        // they watch none, for as long as the read took.
        <PullListSkeleton />
      ) : repos.length === 0 ? (
        <p className="text-ink-muted px-2 py-3 text-sm">
          Watch a repository to see its open pull requests.
        </p>
      ) : loading && data == null ? (
        <PullListSkeleton />
      ) : error != null ? (
        <p className="text-removed px-2 py-3 text-sm">{error}</p>
      ) : groups.length === 0 ? (
        // Every repository failing is not the same as every repository being
        // empty, and the reason is right below. Saying "no open pull requests"
        // over the top of it would be a second, wrong answer.
        failures.length === 0 && (
          <p className="text-ink-muted px-2 py-3 text-sm">
            No open pull requests in{' '}
            {repoFilter ?? repos.map(formatWatchedRepo).join(', ')}.
          </p>
        )
      ) : (
        // A rule between the groups, and none above the first. A heading alone
        // left two authors' pull requests reading as one run, because the
        // heading sits closer to the rows under it than the rows do to each
        // other — which is what a heading is for, and why it cannot also be
        // the boundary.
        groups.map((group, groupIndex) => (
          // The gap belongs between the groups. On the last one it would be
          // a second bottom padding under the menu's or the card's own.
          //
          // The rule is drawn from the index rather than `:first-child`. A
          // group is not always the first child of what holds it, and an author
          // never is: the repository heading is.
          <section
            key={group.key}
            className={cn(
              'border-line pb-1 last:pb-0',
              groupIndex > 0 && 'border-t'
            )}
          >
            {showRepoHeadings && (
              <div className="flex items-baseline gap-2 px-2 pt-2 pb-1">
                <SectionLabel className="min-w-0 truncate">
                  {group.owner}/{group.repo}
                </SectionLabel>
                <span className="text-ink-faint ml-auto text-xs tabular-nums">
                  {group.count}
                </span>
              </div>
            )}
            {group.authors.map((author, authorIndex) => (
              <div
                key={author.author}
                className={cn(
                  'border-line',
                  authorIndex > 0 && 'mt-1 border-t'
                )}
              >
                <p className="text-ink-muted flex items-baseline gap-1.5 px-2 pt-1 pb-0.5 text-xs">
                  <span className="min-w-0 truncate">{author.author}</span>
                  {author.isViewer && (
                    <span className="border-line text-ink-faint shrink-0 rounded border px-1 text-[10px] leading-4">
                      you
                    </span>
                  )}
                </p>
                <PullStack
                  current={current}
                  nodes={author.stacks}
                  onNavigate={onNavigate}
                />
              </div>
            ))}
          </section>
        ))
      )}

      {failures.length > 0 && (
        <div className="border-line mt-1 border-t pt-1">
          {failures.map((failure) => (
            <p key={failure.repo} className="text-removed px-2 py-1 text-xs">
              {failure.repo}: {failure.message}
            </p>
          ))}
        </div>
      )}

      {/* `data.viewer`, not the browser's token: a single-user deployment can
          put the token in `GITHUB_TOKEN`, and the server resolves a viewer from
          it that the browser knows nothing about.

          Only under rows. The note names what a row would gain — the status
          square, and the mark on the reviewer's own pull requests — so under an
          empty list it asks for a token and promises nothing. */}
      {groups.length > 0 && data != null && data.viewer == null && (
        <p className="text-ink-faint border-line mt-1 border-t px-2 py-1.5 text-xs">
          Add a GitHub token to see review and check state, and to mark your own
          pull requests.
        </p>
      )}
    </>
  );
}

/**
 * One author's stacks. A chain of more than one pull request is drawn as a block
 * of its own: a background that holds the whole chain, and the layers badge over
 * it saying how many pull requests are in it. A pull request that stands alone
 * gets neither, so the background means one thing only.
 *
 * The indentation and the guide line inside a block say which pull request
 * stands on which. The block says where the chain begins and ends, which
 * indentation on its own could not: two roots in a row read as one tree.
 */
function PullStack({
  current,
  nodes,
  onNavigate,
}: {
  current?: GitHubPullTarget;
  nodes: readonly PullStackNode[];
  onNavigate?(): void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const size = countStackNodes([node]);
        if (size === 1) {
          return (
            <PullRow
              key={node.pull.number}
              current={current}
              pull={node.pull}
              onNavigate={onNavigate}
            />
          );
        }
        return (
          <div
            key={node.pull.number}
            className="bg-raised/50 inset-ring-line/70 my-1 rounded-md py-0.5 inset-ring"
          >
            <div className="flex justify-end px-2 pt-0.5">
              <PullStackBadge size={size} />
            </div>
            <PullChain
              current={current}
              nodes={[node]}
              onNavigate={onNavigate}
            />
          </div>
        );
      })}
    </>
  );
}

/**
 * The rows of one stack. A pull request stacked on another sits indented under
 * it behind a guide line, so what depends on what is visible without reading a
 * single branch name.
 */
function PullChain({
  current,
  nodes,
  onNavigate,
}: {
  current?: GitHubPullTarget;
  nodes: readonly PullStackNode[];
  onNavigate?(): void;
}) {
  return (
    <>
      {nodes.map((node) => (
        <div key={node.pull.number}>
          <PullRow current={current} pull={node.pull} onNavigate={onNavigate} />
          {node.children.length > 0 && (
            <div className="border-line ml-2.5 border-l pl-0.5">
              <PullChain
                current={current}
                nodes={node.children}
                onNavigate={onNavigate}
              />
            </div>
          )}
        </div>
      ))}
    </>
  );
}

// The shape of the answer, before the answer. A list this size takes a moment
// over the network, and a bare "Loading…" made the section collapse to one line
// and then jump back open. The skeleton holds the space it is about to need.
const SKELETON_GROUPS: readonly (readonly string[])[] = [
  ['82%', '64%'],
  ['74%', '88%', '58%'],
];

export function PullListSkeleton() {
  return (
    <div className="animate-pulse motion-reduce:animate-none" role="status">
      <span className="sr-only">Loading open pull requests…</span>
      <div aria-hidden="true">
        {SKELETON_GROUPS.map((widths, groupIndex) => (
          <div key={groupIndex} className="pb-1">
            <div className="px-2 pt-2 pb-1">
              <Bar className="h-2.5 w-[38%]" />
            </div>
            <div className="px-2 pt-1 pb-0.5">
              <Bar className="h-2.5 w-[24%]" />
            </div>
            {widths.map((width, rowIndex) => (
              <div key={rowIndex} className="px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <Bar className="size-3.5 rounded-sm" />
                  <Bar className="h-3 w-8" />
                  <Bar
                    className="h-3 min-w-0 flex-1"
                    style={{ maxWidth: width }}
                  />
                </div>
                <Bar className="mt-1 h-2 w-[42%] opacity-70" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Bar({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={cn('bg-line/70 block rounded', className)} style={style} />
  );
}
