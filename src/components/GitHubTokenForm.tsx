import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { buttonClass } from '@/components/ui/buttonClass';
import { Input } from '@/components/ui/Input';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { ViewerIdentity } from '@/components/ViewerIdentity';
import type { GitHubTokenState } from '@/hooks/useGitHubToken';
import { cn } from '@/lib/cn';
import {
  ACCESS_LABEL,
  fineGrainedTokenUrl,
  TOKEN_PERMISSIONS,
} from '@/lib/githubToken';

// The link and the list under it are the same four permissions, built once in
// `src/lib/githubToken.ts`. Computed here rather than per render: the URL never
// changes.
const TOKEN_URL = fineGrainedTokenUrl();

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
        <>
          <p className="text-ink-faint text-xs">
            A GitHub personal access token. It stays in this browser and travels
            on each request. ghdiff needs it to read a private diff and to post
            a comment.
          </p>

          <a
            className={buttonClass({
              className: 'mt-2 w-full justify-center',
              size: 'sm',
              variant: 'outline',
            })}
            href={TOKEN_URL}
            rel="noreferrer"
            target="_blank"
          >
            Create a fine-grained token
          </a>

          {/* One row per permission, because the list is read against
              GitHub's own form: a sentence of four permissions has to be
              re-read once per checkbox. */}
          <p className="text-ink-faint mt-2 text-xs">
            The link ticks these for you. Choose the repositories you review:
          </p>
          <ul className="mt-1 text-xs">
            {TOKEN_PERMISSIONS.map(({ access, name }) => (
              <li
                key={name}
                className="flex items-baseline justify-between gap-2 py-0.5"
              >
                <span className="text-ink-muted">{name}</span>
                <span className="text-ink-faint">{ACCESS_LABEL[access]}</span>
              </li>
            ))}
          </ul>
          <p className="text-ink-faint mt-1 text-xs">
            A classic token with the <code>repo</code> scope works too.
          </p>
        </>
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
            placeholder="github_pat_…"
            autoComplete="off"
            aria-label="GitHub personal access token"
            onChange={(event) => setValue(event.target.value)}
          />
          <Button type="submit" variant="outline" size="md">
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
