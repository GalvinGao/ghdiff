'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ColorModeToggle } from '@/components/ColorModeToggle';
import { GitHubTokenControl } from '@/components/GitHubTokenControl';
import { LocalRepoForm } from '@/components/LocalRepoForm';
import { PullSwitcher } from '@/components/PullSwitcher';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useColorMode } from '@/hooks/useColorMode';
import { useGitHubToken } from '@/hooks/useGitHubToken';
import { useWatchedRepos } from '@/hooks/useWatchedRepos';
import { parseGitHubInput, reviewTargetHref } from '@/lib/reviewTarget';

export function HomeScreen() {
  const router = useRouter();
  const colorMode = useColorMode();
  const token = useGitHubToken();
  const watched = useWatchedRepos();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <>
      <header className="border-line bg-surface flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <PullSwitcher
          label="Pick a pull request"
          token={token.token}
          viewerLogin={token.viewer?.login}
          watched={watched}
        />
        <span className="text-ink-faint ml-1 text-xs font-semibold tracking-wide uppercase">
          reviewer
        </span>
        <div className="ml-auto flex items-center gap-1">
          <ColorModeToggle colorMode={colorMode} />
          <GitHubTokenControl token={token} />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 py-12">
        <div className="w-full max-w-xl">
          <h1 className="text-ink text-2xl font-semibold">Review some code</h1>
          <p className="text-ink-muted mt-1 text-sm">
            Open a GitHub pull request, or a range in a git repository on this
            machine. Filter the file list by preset rules, and leave comments
            that go back to GitHub.
          </p>

          <form
            className="mt-6"
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
            <label
              htmlFor="github-target"
              className="text-ink-faint text-[11px] font-semibold tracking-wide uppercase"
            >
              GitHub
            </label>
            <div className="mt-1 flex gap-2">
              <Input
                id="github-target"
                value={input}
                placeholder="https://github.com/owner/repo/pull/123"
                onChange={(event) => setInput(event.target.value)}
              />
              <Button type="submit" variant="solid" size="md">
                Open
              </Button>
            </div>
            {error != null && (
              <p className="text-removed mt-2 text-xs">{error}</p>
            )}
          </form>

          <hr className="border-line my-8" />

          <LocalRepoForm />
        </div>
      </main>
    </>
  );
}
