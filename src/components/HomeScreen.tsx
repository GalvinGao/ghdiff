import { IconArrow } from '@pierre/icons';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { useAppData } from '@/components/AppDataProvider';
import { ColorModeToggle } from '@/components/ColorModeToggle';
import { GitHubTokenForm } from '@/components/GitHubTokenForm';
import { PullRequestList } from '@/components/PullRequestList';
import { RepoPicker } from '@/components/RepoPicker';
import { Button } from '@/components/ui/Button';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { Spinner } from '@/components/ui/Spinner';
import { WatchedReposDialog } from '@/components/WatchedReposDialog';
import { formatWatchedRepo } from '@/lib/pulls';
import { parseGitHubInput, reviewTargetSplat } from '@/lib/reviewTarget';

// The home page carries no chrome of its own. There is no diff on screen yet, so
// a header with a token button and view settings would be a toolbar for
// something that isn't here. The left bar is the app's own chrome and is already
// on the page.

const CARD =
  'border-line bg-raised overflow-hidden rounded-xl border shadow-sm';

export function HomeScreen() {
  const navigate = useNavigate();
  const { colorMode, pulls, token, watched } = useAppData();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [editingRepos, setEditingRepos] = useState(false);
  const [repoFilter, setRepoFilter] = useState<string | undefined>(undefined);

  // A repository can leave the watch list while it is the one selected, and a
  // filter for something nobody watches any more would show an empty list with
  // no way to read it. Falling back to all of them is the honest answer.
  const activeFilter =
    repoFilter != null &&
    watched.repos.some(
      (repo) =>
        formatWatchedRepo(repo).toLowerCase() === repoFilter.toLowerCase()
    )
      ? repoFilter
      : undefined;

  const counts = useMemo(() => {
    if (pulls.data == null) return undefined;
    const result = new Map<string, number>();
    for (const pull of pulls.data.pulls) {
      const key = formatWatchedRepo(pull).toLowerCase();
      result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
  }, [pulls.data]);

  const list = (
    <PullRequestList
      repoFilter={activeFilter}
      repos={watched.repos}
      showRepoHeadings={activeFilter == null}
      state={pulls}
    />
  );

  return (
    // `m-auto` on the column below, not `items-center`: auto margins take the
    // free space when the page is shorter than the window and collapse to
    // nothing when it is taller, so a long page still scrolls from its top
    // instead of having its head cut off.
    <main className="bg-surface flex min-h-0 flex-1 overflow-y-auto overscroll-none">
      {/* The only control that isn't part of the page's own work, so it sits
          out of the column entirely. */}
      <ColorModeToggle
        className="fixed top-3 right-3 z-10"
        colorMode={colorMode}
      />

      <div className="m-auto w-full max-w-2xl px-6 py-14">
        <h1 className="text-ink text-2xl font-semibold tracking-tight">
          reviewer
        </h1>
        <p className="text-ink-muted mt-1.5 text-sm text-pretty">
          Review a GitHub pull request, commit, or compare range. Filter the
          file list by preset rules, and leave comments that go back to GitHub.
        </p>

        {/* Any github.com path works with `/gh` in front of it, which is worth
            showing rather than describing. */}
        <div className="text-ink-muted mt-6 flex flex-col gap-px font-mono text-xs leading-6">
          <code className="border-removed truncate rounded-l border-l-2 pl-2">
            <span className="text-removed">- github.com</span>
            /owner/repo/pull/123
          </code>
          <code className="border-added truncate rounded-l border-l-2 pl-2">
            <span className="text-added">+ /gh</span>
            /owner/repo/pull/123
          </code>
        </div>

        <div className={`${CARD} mt-4`}>
          <form
            className="flex items-center gap-1 px-4"
            onSubmit={(event) => {
              event.preventDefault();
              const target = parseGitHubInput(input);
              if (target == null) {
                setError(
                  'Paste a GitHub pull request, commit, or compare URL, or type owner/repo#123.'
                );
                return;
              }
              setError(undefined);
              void navigate({
                to: '/gh/$',
                params: { _splat: reviewTargetSplat(target) },
              });
            }}
          >
            <label className="sr-only" htmlFor="github-target">
              GitHub pull request, commit, or compare URL
            </label>
            <input
              id="github-target"
              value={input}
              placeholder="https://github.com/owner/repo/pull/123"
              enterKeyHint="go"
              className="text-ink placeholder:text-ink-faint h-12 min-w-0 flex-1 bg-transparent text-sm focus-visible:outline-none"
              onChange={(event) => {
                setInput(event.target.value);
                if (error != null) setError(undefined);
              }}
            />
            <Button
              aria-label="Open this diff"
              disabled={input.trim().length === 0}
              size="icon-sm"
              title="Open this diff"
              type="submit"
              variant="quiet"
            >
              <IconArrow className="rotate-180" size={15} />
            </Button>
          </form>
          {error != null && (
            <p className="text-removed border-line border-t px-4 py-2 text-xs">
              {error}
            </p>
          )}
          <GitHubTokenForm
            className="border-line border-t px-4 py-3"
            heading="Private GitHub access"
            token={token}
          />
        </div>

        <div className="mt-10 flex items-center gap-2">
          <SectionLabel>Open pull requests</SectionLabel>
          {pulls.loading && <Spinner label="Loading the pull requests" />}
          <Button
            className="ml-auto"
            size="sm"
            variant="chrome"
            onClick={() => setEditingRepos(true)}
          >
            Watched repos
          </Button>
        </div>
        <div className={`${CARD} mt-2`}>
          {/* The picker only earns its column when there is something to pick
              between. With one repository it would name the repository twice. */}
          {watched.repos.length > 1 ? (
            <div className="divide-line grid grid-cols-[9rem_minmax(0,1fr)] divide-x">
              <div className="p-1">
                <RepoPicker
                  counts={counts}
                  repos={watched.repos}
                  total={pulls.data?.pulls.length}
                  value={activeFilter}
                  onChange={setRepoFilter}
                />
              </div>
              <div className="p-1">{list}</div>
            </div>
          ) : (
            <div className="p-1">{list}</div>
          )}
        </div>

        <WatchedReposDialog
          open={editingRepos}
          watched={watched}
          onClose={() => {
            setEditingRepos(false);
            pulls.reload();
          }}
        />

        <p className="text-ink-faint mt-10 text-xs">
          The diff is{' '}
          <a
            className="hover:text-ink underline"
            href="https://diffs.com"
            rel="noreferrer"
            target="_blank"
          >
            CodeView
          </a>{' '}
          and the file list is{' '}
          <a
            className="hover:text-ink underline"
            href="https://trees.software"
            rel="noreferrer"
            target="_blank"
          >
            FileTree
          </a>
          , both by Pierre.
        </p>
      </div>
    </main>
  );
}
