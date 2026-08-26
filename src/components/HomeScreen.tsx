import { IconArrow, IconBrandGithub } from '@pierre/icons';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { useAppData } from '@/components/AppDataProvider';
import { ColorModeToggle } from '@/components/ColorModeToggle';
import { ExampleTargets } from '@/components/ExampleTargets';
import { GitHubTokenForm } from '@/components/GitHubTokenForm';
import { PullRequestList } from '@/components/PullRequestList';
import { RepoPicker } from '@/components/RepoPicker';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { Spinner } from '@/components/ui/Spinner';
import { UserscriptInstall } from '@/components/UserscriptInstall';
import { ViewerAvatar, viewerDisplayName } from '@/components/ViewerIdentity';
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
  const [editingToken, setEditingToken] = useState(false);
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

  const viewer = token.viewer;

  const list = (
    <PullRequestList
      hydrated={watched.hydrated}
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
          ghdiff.com
        </h1>
        {/* One line per thing the app does. Three clauses in one paragraph read
            as a sentence to get through; three lines read as a list. */}
        <div className="text-ink-muted mt-1.5 space-y-0.5 text-sm">
          <p>Open any GitHub pull request, commit, or compare range.</p>
          <p>Narrow the file list with preset path rules.</p>
          <p>Read and leave comments.</p>
        </div>

        {/* The whole instruction is the host swap, which is worth showing
            rather than describing. Square corners, because these two lines are
            a diff and a diff has none. */}
        <div className="text-ink-muted mt-6 flex flex-col gap-px font-mono text-xs leading-6">
          <code className="border-removed truncate border-l-2 pl-2">
            <span className="text-removed">{'- '}</span>
            <span className="bg-removed/15 text-removed rounded-xs px-0.5 font-semibold">
              github
            </span>
            .com/owner/repo/pull/123
          </code>
          <code className="border-added truncate border-l-2 pl-2">
            <span className="text-added">{'+ '}</span>
            <span className="bg-added/15 text-added rounded-xs px-0.5 font-semibold">
              ghdiff
            </span>
            .com/owner/repo/pull/123
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
                to: '/$',
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
            {/* The page's primary action, so it is filled and it is named.
                A bare glyph left the one thing to do here looking like a hint. */}
            <Button
              disabled={input.trim().length === 0}
              size="md"
              title="Open this diff"
              type="submit"
              variant="solid"
            >
              Review
              <IconArrow className="rotate-180" size={15} />
            </Button>
          </form>
          {error != null && (
            <p className="text-removed border-line border-t px-4 py-2 text-xs">
              {error}
            </p>
          )}
          {/* The form itself is a heading, a paragraph, a link, four
              permissions and a field, and none of that is the reader's next
              move on this page — pasting a URL is. So the card keeps one strip
              that says what it opens, the width of the row above it and
              clickable across all of it, and the form fills a dialog. */}
          {/* The rule is the wrapper's. `quiet` already sets a transparent
              border on all four sides of the button, so colouring one of them
              from here would fight it. */}
          <div className="border-line border-t">
            <Button
              className="h-10 w-full justify-center rounded-none"
              size="md"
              variant="quiet"
              onClick={() => setEditingToken(true)}
            >
              {viewer != null ? (
                <>
                  <ViewerAvatar size={18} viewer={viewer} />
                  <span className="min-w-0 truncate">
                    {viewerDisplayName(viewer)}
                  </span>
                </>
              ) : (
                <>
                  Set up private GitHub access
                  <IconArrow className="rotate-180" size={14} />
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Pasting a URL is the page's own answer, and this is the answer for
            the reviewer who never leaves github.com. It follows the form
            because it is the same move, made by a button instead. */}
        <div className="mt-10">
          <SectionLabel>Userscript</SectionLabel>
        </div>
        <div className={`${CARD} mt-2`}>
          <UserscriptInstall />
        </div>

        {/* Nothing on this page moves until somebody pastes a URL, and a
            reviewer arriving with no pull request of their own to read has no
            way to find out what the surface does. These are that way in. */}
        <div className="mt-10">
          <SectionLabel>Examples</SectionLabel>
        </div>
        <div className={`${CARD} mt-2 p-1`}>
          <ExampleTargets />
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

        <Dialog
          className="p-4"
          open={editingToken}
          title="Private GitHub access"
          onClose={() => setEditingToken(false)}
        >
          <GitHubTokenForm token={token} />
        </Dialog>

        <WatchedReposDialog
          open={editingRepos}
          watched={watched}
          onClose={() => {
            setEditingRepos(false);
            pulls.reload();
          }}
        />

        <p className="text-ink-faint mt-10 text-xs">
          Diffs via{' '}
          <a
            className="hover:text-ink underline"
            href="https://diffs.com"
            rel="noreferrer"
            target="_blank"
          >
            CodeView
          </a>{' '}
          and file list via{' '}
          <a
            className="hover:text-ink underline"
            href="https://trees.software"
            rel="noreferrer"
            target="_blank"
          >
            FileTree
          </a>
          .
        </p>
        <p className="mt-1">
          {/* The mark, not a word: this line names a repository, and the line
              above it names two libraries the same size in the same colour. */}
          <a
            className="text-ink-faint hover:text-ink inline-flex items-center gap-1.5 text-xs"
            href="https://github.com/GalvinGao/ghdiff"
            rel="noreferrer"
            target="_blank"
          >
            <IconBrandGithub aria-hidden="true" size={13} />
            <span className="underline">Source on GitHub</span>
          </a>
        </p>
      </div>
    </main>
  );
}
