import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import { GitHubIconLink, GitHubTextLink } from '@/components/GitHubLink';
import { PullRow } from '@/components/PullRow';
import { PullStackBadge } from '@/components/PullStackBadge';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SkeletonBar } from '@/components/ui/SkeletonBar';
import type { OpenPullsState } from '@/hooks/useOpenPulls';
import { railStackFlipKey } from '@/hooks/useRailFlip';
import { cn } from '@/lib/cn';
import { repoPullsUrl, repoUrl } from '@/lib/githubUrls';
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
  repos: readonly WatchedRepo[];
  state: OpenPullsState;
}

/**
 * Open pull requests, in the order a reviewer reads them: which repository, then
 * who wrote them, then which stack they belong to. Anything still level with
 * something else goes by pull request number, newest first.
 *
 * The left bar renders this, and does not own the loading, empty, and failure
 * states.
 */
export function PullRequestList({
  current,
  hydrated,
  onNavigate,
  repos,
  state,
}: PullRequestListProps) {
  const { data, error, loading } = state;

  const groups = useMemo(() => {
    if (data == null) return [];
    return groupPullsByRepo(data.pulls, data.viewer);
  }, [data]);

  const failures = data?.failures ?? [];
  // The account to name on the setup page, when every failure shares one. Two
  // accounts failing is a general question, and `undefined` is what asks it.
  // `null` is the third answer: nothing failed, or nobody is signed in, and there
  // is nothing to offer at all.
  // On `data` and not on `failures`: the latter is `data?.failures ?? []`, so it
  // is a fresh array on every render where nothing has arrived yet.
  const failedAccount = useMemo(() => {
    const rows = data?.failures ?? [];
    if (rows.length === 0 || data?.viewer == null) return null;
    const owners = new Set(rows.map((failure) => failure.repo.split('/')[0]));
    return owners.size === 1 ? [...owners][0] : undefined;
  }, [data]);

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
      ) : loading && groups.length === 0 ? (
        // Nothing to show and an answer on the way: the first load, and the
        // moment after the first repository is watched, when `data` is the
        // empty answer the hook gives an empty watch list. Saying "no open
        // pull requests in it" there is a wrong answer to a question GitHub
        // has not answered yet. A reload with rows already on screen keeps
        // them, because `groups` is not empty.
        <PullListSkeleton />
      ) : error != null ? (
        <p className="text-removed px-2 py-3 text-sm">{error}</p>
      ) : groups.length === 0 ? (
        // Every repository failing is not the same as every repository being
        // empty, and the reason is right below. Saying "no open pull requests"
        // over the top of it would be a second, wrong answer.
        failures.length === 0 && (
          <p className="text-ink-muted px-2 py-3 text-sm">
            No open pull requests in {repos.map(formatWatchedRepo).join(', ')}.
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
            {/* The repository's name goes to the repository, and the count
                goes to the rows it counted: GitHub's own open pull requests
                for it. Both are the answer to "what is this", so both are the
                text itself rather than a glyph beside it. */}
            <div className="flex items-baseline gap-2 px-2 pt-2 pb-1">
              <SectionLabel className="min-w-0">
                <GitHubTextLink
                  className="block truncate"
                  href={repoUrl(group)}
                  title={`Open ${group.owner}/${group.repo} on GitHub`}
                >
                  {group.owner}/{group.repo}
                </GitHubTextLink>
              </SectionLabel>
              <GitHubTextLink
                className="text-ink-faint ml-auto shrink-0 text-xs tabular-nums"
                href={repoPullsUrl(group)}
                title={`Open the ${String(group.count)} open pull requests on GitHub`}
              >
                {group.count}
              </GitHubTextLink>
            </div>
            {group.authors.map((author, authorIndex) => (
              <div
                key={author.author}
                className={cn(
                  'border-line',
                  authorIndex > 0 && 'mt-1 border-t'
                )}
              >
                {/* An author is a name, not a link: the row under it is what
                    the reviewer came for. The arrow appears with the pointer
                    and takes them to the same author's pull requests on
                    GitHub, and it holds its space at all times so no heading
                    moves when it arrives. */}
                <p className="group text-ink-muted flex items-center gap-1.5 px-2 pt-1 pb-0.5 text-xs">
                  <span className="min-w-0 truncate">{author.author}</span>
                  {author.isViewer && (
                    <span className="border-line text-ink-faint shrink-0 rounded border px-1 text-[10px] leading-4">
                      you
                    </span>
                  )}
                  <GitHubIconLink
                    href={repoPullsUrl(group, { author: author.author })}
                    label={`Open ${author.author}'s open pull requests in ${group.owner}/${group.repo} on GitHub`}
                  />
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
          {/* The offer this list used to be missing. GitHub answers "Could not
              resolve to a Repository" both for a repository that is not there
              and for one the App is not installed on, in the same words, so this
              cannot say which — and it does not claim to. What it can do is name
              the one cause a reviewer can act on, which is the far more likely of
              the two for a repository they put on this list themselves.

              Only when signed in: a signed-out reviewer's failures are about a
              credential, and the account menu is already asking for one. And only
              once, because a line per failing repository would bury the rows
              above it. */}
          {failedAccount !== null && (
            <Link
              className="text-ink-faint hover:text-ink hover:bg-surface block rounded px-2 py-1 text-xs underline"
              onClick={onNavigate}
              search={{
                account: failedAccount,
                from: undefined,
                migrated: undefined,
              }}
              to="/setup"
            >
              Set up private access
            </Link>
          )}
        </div>
      )}

      {/* `data.viewer`, not whether this browser signed in: a single-user
          deployment can put a token in `GITHUB_TOKEN`, and the server resolves
          a viewer from it that the browser knows nothing about.

          Only under rows. The note names what a row would gain — the status
          square, and the mark on the reviewer's own pull requests — so under an
          empty list it asks for a sign-in and promises nothing. */}
      {groups.length > 0 && data != null && data.viewer == null && (
        <p className="text-ink-faint border-line mt-1 border-t px-2 py-1.5 text-xs">
          Signed out, no row shows a status square or a mark on your own pull
          requests. Signing in supplies both.
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
            {/* The block's caption: what it is on the left, how big it is on
                the right. The count alone left the reader to work out what a
                background and a layers glyph meant, and it sat against an empty
                half-row. The word is the badge's own size and colour, so the
                two read as one quiet line above the rows rather than as a
                heading over them. The collapsed bar gets the badge and no word:
                it is the width of one square. */}
            <div className="flex items-center justify-between gap-2 px-2 pt-0.5">
              <span className="text-ink-faint text-[10px] leading-none font-medium">
                Stack
              </span>
              {/* The same badge the collapsed bar puts at the top of this
                  stack's block, marked with the same key, so a toggle flies
                  one badge between the two places (hooks/useRailFlip.ts). */}
              <span
                className="flex"
                data-rail-flip={railStackFlipKey(node.pull)}
              >
                <PullStackBadge size={size} />
              </span>
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
              <SkeletonBar className="h-2.5 w-[38%]" />
            </div>
            <div className="px-2 pt-1 pb-0.5">
              <SkeletonBar className="h-2.5 w-[24%]" />
            </div>
            {widths.map((width, rowIndex) => (
              <div key={rowIndex} className="px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <SkeletonBar className="size-3.5 rounded-sm" />
                  <SkeletonBar className="h-3 w-8" />
                  <SkeletonBar
                    className="h-3 min-w-0 flex-1"
                    style={{ maxWidth: width }}
                  />
                </div>
                <SkeletonBar className="mt-1 h-2 w-[42%] opacity-70" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
