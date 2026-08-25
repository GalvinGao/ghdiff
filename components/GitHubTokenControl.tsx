'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { Input } from '@/components/ui/Input';
import type { GitHubTokenState } from '@/hooks/useGitHubToken';

/**
 * The token stays in this browser's local storage and travels on the
 * Authorization header of each request. The server never stores it.
 */
export function GitHubTokenControl({ token }: { token: GitHubTokenState }) {
  const [value, setValue] = useState('');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          {token.viewer != null
            ? token.viewer.login
            : token.hasToken
              ? 'Token set'
              : 'Add token'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-3">
        <p className="text-ink-faint mb-2 text-xs">
          A GitHub personal access token with the <code>repo</code> scope. It
          stays in this browser and travels on each request. Reviewer needs it
          to read a private diff and to post a comment.
        </p>
        {token.viewer != null && (
          <p className="text-ink-muted mb-2 text-sm">
            Signed in as <strong>{token.viewer.login}</strong>.
          </p>
        )}
        {token.viewerError != null && (
          <p className="text-removed mb-2 text-xs">{token.viewerError}</p>
        )}
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            token.setToken(value);
            setValue('');
          }}
        >
          <Input
            type="password"
            value={value}
            placeholder="ghp_…"
            autoComplete="off"
            onChange={(event) => setValue(event.target.value)}
          />
          <Button type="submit" variant="solid" size="md">
            Save
          </Button>
        </form>
        {token.hasToken && (
          <Button
            variant="danger"
            size="sm"
            className="mt-2"
            onClick={() => token.clearToken()}
          >
            Remove token
          </Button>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
