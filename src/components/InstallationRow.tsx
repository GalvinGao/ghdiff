import { IconArrowUpRight } from '@pierre/icons';

import { buttonClass } from '@/components/ui/buttonClass';
import { SkeletonBar } from '@/components/ui/SkeletonBar';
import { cn } from '@/lib/cn';
import {
  type AppInstallation,
  describeInstallationReach,
} from '@/lib/installations';

// The row and the shape of the row, side by side and sharing every class that
// decides how tall it is. A skeleton whose figures were copied would drift from
// the row it stands in for, and the drift is exactly the layout shift it exists
// to prevent.

const ROW_CLASS = 'flex items-center justify-between gap-2';
/** The account. `text-sm` is a 20px line box. */
const NAME_CLASS = 'text-ink truncate text-sm';
/** What it reaches. `text-xs` is a 16px line box. */
const REACH_CLASS = 'text-ink-faint text-xs';
/** `Configure` and its arrow measure 93px at this size. The placeholder takes
    the nearest step of the app's own spacing scale, which is 92. */
const CONFIGURE_WIDTH = 'w-23';

/**
 * One account ghdiff is installed on, and how far that installation reaches.
 *
 * The reach is the whole reason this row exists. "Installed" is the fact a
 * reviewer already believes by the time they are reading it, and the figure
 * beside it is the one that explains a 404 they are still getting — an
 * installation covering a chosen list of nothing looks exactly like success from
 * every other angle.
 *
 * The wrapper's classes come from the caller rather than from here. The setup
 * page puts these on cards down a wide column, and the account menu puts them
 * bare in about 296px; everything inside is the same at both widths, and the box
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
    <div className={cn(ROW_CLASS, className)}>
      <div className="min-w-0">
        <p className={NAME_CLASS}>
          {installation.account}
          {wanted === true && (
            <span className="text-ink-faint ml-2 text-xs">current diff</span>
          )}
        </p>
        <p className={REACH_CLASS}>{describeInstallationReach(installation)}</p>
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

/**
 * The same row, before GitHub has answered.
 *
 * The two bars are `inline-block` inside the row's own paragraphs rather than
 * blocks in place of them, so each one keeps the line box its sentence would
 * have had: 20px and 16px, and a row exactly as tall either way. `0.75em` then
 * makes each bar three quarters of its own text size, which `align-middle`
 * centres inside that line box without growing it.
 *
 * The control is a bar and not a greyed-out `Configure`: a button drawn in full
 * that answers no press is a worse promise than an obvious placeholder, and
 * `h-7` is its height whichever it is.
 */
export function InstallationRowSkeleton({
  className,
  nameWidth,
  reachWidth,
}: {
  className?: string;
  /** Varied per row, so three of these do not read as a table. */
  nameWidth: string;
  reachWidth: string;
}) {
  return (
    <div aria-hidden="true" className={cn(ROW_CLASS, className)}>
      <div className="min-w-0">
        <p className={NAME_CLASS}>
          <SkeletonBar
            className={cn('inline-block h-[0.75em] align-middle', nameWidth)}
          />
        </p>
        <p className={REACH_CLASS}>
          <SkeletonBar
            className={cn('inline-block h-[0.75em] align-middle', reachWidth)}
          />
        </p>
      </div>
      <SkeletonBar className={cn('h-7 shrink-0 rounded-md', CONFIGURE_WIDTH)} />
    </div>
  );
}
