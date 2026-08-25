import { GitHubTokenForm } from '@/components/GitHubTokenForm';
import { Button } from '@/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import type { GitHubTokenState } from '@/hooks/useGitHubToken';

/**
 * The header's entry to the token form. It names the account the token belongs
 * to, because that is who every comment will be posted as. With no token set it
 * takes a border and asks for one, since nothing private will load without it.
 */
export function GitHubTokenControl({ token }: { token: GitHubTokenState }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant={token.hasToken ? 'chrome' : 'outline'}>
          {token.viewer != null
            ? token.viewer.login
            : token.hasToken
              ? 'Token set'
              : 'Add token'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-3">
        <GitHubTokenForm token={token} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
