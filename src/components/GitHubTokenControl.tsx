import { GitHubTokenForm } from '@/components/GitHubTokenForm';
import { Button } from '@/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { ViewerAvatar, viewerDisplayName } from '@/components/ViewerIdentity';
import type { GitHubTokenState } from '@/hooks/useGitHubToken';

/**
 * The header's entry to the token form. It shows the account the token belongs
 * to, because that is who every comment will be posted as. With no token set it
 * takes a border and asks for one, since nothing private will load without it.
 */
export function GitHubTokenControl({ token }: { token: GitHubTokenState }) {
  const viewer = token.viewer;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          // A round picture needs less room on its own side than a word does.
          className={viewer != null ? 'max-w-40 pl-1' : undefined}
          size="sm"
          variant={token.hasToken ? 'chrome' : 'outline'}
        >
          {viewer != null ? (
            <>
              <ViewerAvatar size={18} viewer={viewer} />
              <span className="text-ink truncate">
                {viewerDisplayName(viewer)}
              </span>
            </>
          ) : token.hasToken ? (
            'Token set'
          ) : (
            'Add token'
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-3">
        <GitHubTokenForm token={token} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
