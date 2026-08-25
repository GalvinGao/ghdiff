'use client';

import type { GitHubViewer } from '@/hooks/useGitHubToken';
import { cn } from '@/lib/cn';

// Who the token belongs to. Every comment reviewer posts carries this account,
// so the header says whose it is before anything is typed, and the menu behind
// it says it in full. A login on its own is a word in a toolbar; the picture is
// what makes it read as an account.

export function ViewerAvatar({
  className,
  size,
  viewer,
}: {
  className?: string;
  /** Side of the square, in pixels. */
  size: number;
  viewer: GitHubViewer;
}) {
  const shared = cn('shrink-0 rounded-full', className);

  // A token can be valid and still have no picture, so the initial stands in
  // and the row keeps its shape either way.
  if (viewer.avatarUrl == null) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'bg-surface text-ink-faint border-line flex items-center justify-center border font-medium uppercase',
          shared
        )}
        style={{ fontSize: Math.round(size * 0.5), height: size, width: size }}
      >
        {viewer.login.slice(0, 1)}
      </span>
    );
  }

  return (
    // The login sits beside every one of these, so the picture adds nothing to
    // a reader who cannot see it.
    <img
      alt=""
      className={cn('border-line border', shared)}
      height={size}
      referrerPolicy="no-referrer"
      src={viewer.avatarUrl}
      width={size}
    />
  );
}

/** An account with no name set answers with its login. */
export function viewerDisplayName(viewer: GitHubViewer): string {
  const name = viewer.name;
  return name != null && name.length > 0 ? name : viewer.login;
}

/** The account in full: picture, name, and the login under it. */
export function ViewerIdentity({
  className,
  viewer,
}: {
  className?: string;
  viewer: GitHubViewer;
}) {
  const name = viewerDisplayName(viewer);

  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <ViewerAvatar size={32} viewer={viewer} />
      <div className="min-w-0">
        <p className="text-ink truncate text-sm font-medium">{name}</p>
        {/* Only when it says something the line above did not. */}
        {name !== viewer.login && (
          <p className="text-ink-faint truncate text-xs">@{viewer.login}</p>
        )}
      </div>
    </div>
  );
}
