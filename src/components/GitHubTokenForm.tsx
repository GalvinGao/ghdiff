import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { ViewerIdentity } from '@/components/ViewerIdentity';
import type { GitHubTokenState } from '@/hooks/useGitHubToken';
import { cn } from '@/lib/cn';

/**
 * The token form itself, with no surface of its own. The header shows it inside
 * a menu and the home page shows it inside a card, and both need the same
 * fields, so the fields do not live in either one.
 *
 * Once the token works, the field goes away. A signed-in reviewer has nothing
 * left to type here, and an empty password box under their own name reads as if
 * something is still wanted from them. What is left is who they are signed in
 * as, which decides whose name their comments will carry.
 *
 * The token stays in this browser's local storage and travels on the
 * Authorization header of each request. The server never stores it.
 */
export function GitHubTokenForm({
  className,
  heading,
  token,
}: {
  className?: string;
  heading?: string;
  token: GitHubTokenState;
}) {
  const [value, setValue] = useState('');
  const viewer = token.viewer;

  return (
    <div className={cn('min-w-0', className)}>
      {heading != null && (
        <SectionLabel className="mb-1.5 block">{heading}</SectionLabel>
      )}

      {viewer != null ? (
        <>
          <ViewerIdentity viewer={viewer} />
          <p className="text-ink-faint mt-2 text-xs">
            Comments you leave go to GitHub under this account.
          </p>
        </>
      ) : (
        <p className="text-ink-faint text-xs">
          A GitHub personal access token with the <code>repo</code> scope. It
          stays in this browser and travels on each request. Reviewer needs it
          to read a private diff and to post a comment.
        </p>
      )}

      {token.viewerError != null && (
        <p className="text-removed mt-2 text-xs">{token.viewerError}</p>
      )}

      {viewer == null && (
        <form
          className="mt-2 flex gap-2"
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
            aria-label="GitHub personal access token"
            onChange={(event) => setValue(event.target.value)}
          />
          <Button type="submit" variant="solid" size="md">
            Save
          </Button>
        </form>
      )}

      {token.hasToken && (
        <Button
          variant="danger"
          size="sm"
          className="mt-2"
          onClick={() => token.clearToken()}
        >
          {viewer != null ? 'Sign out' : 'Remove token'}
        </Button>
      )}
    </div>
  );
}
