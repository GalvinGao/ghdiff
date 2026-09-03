import { IconBrandGithub } from '@pierre/icons';
import { Link } from '@tanstack/react-router';

import { GitHubAccountPanel } from '@/components/GitHubAccountPanel';
import { Button } from '@/components/ui/Button';
import { buttonClass } from '@/components/ui/buttonClass';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { ViewerAvatar, viewerDisplayName } from '@/components/ViewerIdentity';
import type { GitHubSessionState } from '@/hooks/useGitHubSession';

/**
 * The header's account control, which is two different controls.
 *
 * Signed out it is a link to `/setup`, not a sign-in. Signing in is only the
 * first of two things a reviewer needs, and a control that jumped straight to
 * GitHub left them to discover the second one as a 404 — so the label says where
 * it goes rather than promising a redirect it no longer makes.
 *
 * Signed in it is a menu, because there is something to see — the account every
 * comment will be posted as — and something to do about it.
 *
 * While the answer is still coming it is neither. Whose account this is takes one
 * request to find out, and **Sign in** on screen for the length of it is a wrong
 * statement to every reviewer who already is. The home page keeps its button
 * through the wait instead: it is a row of the page's own content there, and a
 * gap that fills in reads worse than a label that settles.
 */
export function GitHubAccountControl({
  session,
}: {
  session: GitHubSessionState;
}) {
  const viewer = session.viewer;

  if (session.checking) return null;

  if (viewer == null) {
    return (
      <Link
        className={buttonClass({ size: 'sm', variant: 'outline' })}
        search={{ account: undefined, from: undefined, migrated: undefined }}
        to="/setup"
      >
        <IconBrandGithub aria-hidden="true" size={14} />
        Set up access
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          // A round picture needs less room on its own side than a word does.
          className="max-w-40 pl-1"
          size="sm"
          variant="chrome"
        >
          <ViewerAvatar size={18} viewer={viewer} />
          <span className="text-ink truncate">{viewerDisplayName(viewer)}</span>
        </Button>
      </DropdownMenuTrigger>
      {/* Wider than it was: it now carries a list of accounts with a control on
          each row, not one line of identity. */}
      <DropdownMenuContent align="end" className="w-80 p-3">
        {/* Radix unmounts this while the menu is closed, so being rendered here
            is the same fact as being on screen. */}
        <GitHubAccountPanel active session={session} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
