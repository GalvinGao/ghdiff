'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SectionLabel } from '@/components/ui/SectionLabel';
import type { WatchedReposState } from '@/hooks/useWatchedRepos';
import { formatWatchedRepo } from '@/lib/pullSwitcher';

interface WatchedReposEditorProps {
  onDone(): void;
  watched: WatchedReposState;
}

/** The watch list lives in this browser, so no server holds it. */
export function WatchedReposEditor({
  onDone,
  watched,
}: WatchedReposEditorProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <div className="p-2">
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>Watched repositories</SectionLabel>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={onDone}
        >
          Done
        </Button>
      </div>

      <form
        className="mb-2 flex gap-2"
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
          autoFocus
          onChange={(event) => setInput(event.target.value)}
        />
        <Button type="submit" variant="solid" size="md">
          Add
        </Button>
      </form>
      {error != null && <p className="text-removed mb-2 text-xs">{error}</p>}

      {watched.repos.length === 0 ? (
        <p className="text-ink-muted text-sm">Nothing watched yet.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
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
