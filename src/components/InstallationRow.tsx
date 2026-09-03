import { IconArrowUpRight } from '@pierre/icons';

import { buttonClass } from '@/components/ui/buttonClass';
import { cn } from '@/lib/cn';
import {
  type AppInstallation,
  describeInstallationReach,
} from '@/lib/installations';

/**
 * One account ghdiff is installed on, and how far that installation reaches.
 *
 * The reach is the whole reason this row exists. "Installed" is the fact a
 * reviewer already believes by the time they are reading it, and the figure
 * beside it is the one that explains a 404 they are still getting — an
 * installation covering a chosen list of nothing looks like success from every
 * other angle.
 *
 * The wrapper's classes come from the caller rather than from here. The setup
 * page puts these on cards down a wide column, and the account menu puts them
 * bare in about 260px; everything inside is the same at both widths, and the box
 * around them is not.
 */
export function InstallationRow({
  className,
  installation,
  wanted,
}: {
  className?: string;
  installation: AppInstallation;
  /** True for the account whose code is on screen. */
  wanted?: boolean;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <div className="min-w-0">
        <p className="text-ink truncate text-sm">
          {installation.account}
          {wanted === true && (
            <span className="text-ink-faint ml-2 text-xs">current diff</span>
          )}
        </p>
        <p className="text-ink-faint text-xs">
          {describeInstallationReach(installation)}
        </p>
      </div>
      {/* GitHub's own URL for this installation, never one built here: a
          personal installation and an organization's live under different paths,
          and GitHub is the only authority on which of the two this is. */}
      <a
        className={buttonClass({
          className: 'shrink-0',
          size: 'sm',
          variant: 'outline',
        })}
        href={installation.settingsUrl}
        rel="noreferrer"
        target="_blank"
      >
        Configure
        <IconArrowUpRight aria-hidden="true" size={12} />
      </a>
    </div>
  );
}
