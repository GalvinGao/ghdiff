'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { WatchedReposState } from '@/hooks/useWatchedRepos';
import { formatWatchedRepo } from '@/lib/pulls';

/**
 * The watch list, and nothing around it: the dialog that shows this owns the
 * title and the way out. The list lives in this browser, so no server holds it.
 */
export function WatchedReposEditor({
  watched,
}: {
  watched: WatchedReposState;
}) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <div>
      <p className="text-ink-faint mb-2 text-xs">
        Reviewer lists the open pull requests of these repositories. The list
        stays in this browser.
      </p>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (watched.add(input)) {
            setInput('');
            setError(undefined);
          } else {
            setError('Give a repository as owner/repo.');
          }
        }}
      >
        <Input
          value={input}
          placeholder="owner/repo"
          aria-label="Repository to watch"
          onChange={(event) => setInput(event.target.value)}
        />
        <Button type="submit" variant="solid" size="md">
          Add
        </Button>
      </form>
      {error != null && <p className="text-removed mt-2 text-xs">{error}</p>}

      {watched.repos.length === 0 ? (
        <p className="text-ink-muted mt-3 text-sm">Nothing watched yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-0.5">
          {watched.repos.map((repo) => (
            <li
              key={formatWatchedRepo(repo)}
              className="hover:bg-surface flex items-center gap-2 rounded-md px-2 py-1 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                {formatWatchedRepo(repo)}
              </span>
              <Button
                size="sm"
                variant="danger"
                onClick={() => watched.remove(repo)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
