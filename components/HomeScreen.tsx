'use client';

import { IconArrow } from '@pierre/icons';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ColorModeToggle } from '@/components/ColorModeToggle';
import { GitHubTokenForm } from '@/components/GitHubTokenForm';
import { PullRequestList } from '@/components/PullRequestList';
import { Button } from '@/components/ui/Button';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { WatchedReposEditor } from '@/components/WatchedReposEditor';
import { useColorMode } from '@/hooks/useColorMode';
import { useGitHubToken } from '@/hooks/useGitHubToken';
import { usePullSwitcher } from '@/hooks/usePullSwitcher';
import { useWatchedRepos } from '@/hooks/useWatchedRepos';
import { parseGitHubInput, reviewTargetHref } from '@/lib/reviewTarget';

// The home page carries no chrome. There is no diff on screen yet, so a header
// with a switcher, a token button, and view settings would be a toolbar for
// something that isn't here: the switcher's list is the page's main content
// instead, and the token is a field in the box that needs it.

const CARD =
  'border-line bg-raised overflow-hidden rounded-xl border shadow-sm';

export function HomeScreen() {
  const router = useRouter();
  const colorMode = useColorMode();
  const token = useGitHubToken();
  const watched = useWatchedRepos();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [editingRepos, setEditingRepos] = useState(false);
  // The list is the page, not a menu, so it loads with the page.
  const pulls = usePullSwitcher({
    active: true,
    repos: watched.repos,
    token: token.token,
  });

  return (
    <main className="bg-surface min-h-0 flex-1 overflow-y-auto overscroll-none">
      {/* The only control that isn't part of the page's own work, so it sits
          out of the column entirely. */}
      <ColorModeToggle
        className="fixed top-3 right-3 z-10"
        colorMode={colorMode}
      />

      <div className="mx-auto w-full max-w-2xl px-6 py-14">
        <h1 className="text-ink text-2xl font-semibold tracking-tight">
          reviewer
        </h1>
        <p className="text-ink-muted mt-1.5 text-sm text-pretty">
          Review a GitHub pull request, or a range in a git repository on this
          machine. Filter the file list by preset rules, and leave comments that
          go back to GitHub.
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
              router.push(reviewTargetHref(target));
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
          <Button
            aria-pressed={editingRepos}
            className="ml-auto"
            size="sm"
            variant="chrome"
            onClick={() => {
              setEditingRepos((current) => !current);
              if (editingRepos) pulls.reload();
            }}
          >
            Watched repos
          </Button>
        </div>
        <div className={`${CARD} mt-2 p-1`}>
          {editingRepos ? (
            <WatchedReposEditor
              watched={watched}
              onDone={() => {
                setEditingRepos(false);
                pulls.reload();
              }}
            />
          ) : (
            <PullRequestList
              repos={watched.repos}
              state={pulls}
              viewerLogin={token.viewer?.login}
            />
          )}
        </div>

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
