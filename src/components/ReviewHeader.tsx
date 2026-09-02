import type { DiffIndicators } from '@pierre/diffs';
import {
  IconApproved,
  IconCodeStyleBars,
  IconComment,
  IconDiffSplit,
  IconDiffUnified,
  IconEyeSlash,
  IconFileTree,
  IconGearFill,
  IconInReview,
  IconSymbolDiffstat,
  IconX,
} from '@pierre/icons';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { ColorModeToggle } from '@/components/ColorModeToggle';
import { GitHubTextLink } from '@/components/GitHubLink';
import { GitHubTokenControl } from '@/components/GitHubTokenControl';
import { PullDetailsCard } from '@/components/PullDetailsCard';
import { PullListButton } from '@/components/PullListButton';
import { ReviewSubmitDialog } from '@/components/ReviewSubmitDialog';
import { Button } from '@/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import type { CodeFontState } from '@/hooks/useCodeFont';
import type { ColorModeState } from '@/hooks/useColorMode';
import { useEdgeFade } from '@/hooks/useEdgeFade';
import type { GitHubTokenState } from '@/hooks/useGitHubToken';
import type { PullDetailsState } from '@/hooks/usePullDetails';
import type { SubmitReviewState } from '@/hooks/useSubmitReview';
import { cn } from '@/lib/cn';
import { CODE_FONTS, type CodeFontId } from '@/lib/codeFonts';
import type { StatusTone } from '@/lib/pullStatus';
import {
  describeSubmittedReview,
  type ReviewVerdict,
  reviewVerdict,
} from '@/lib/reviewDecision';
import type { ViewerControls } from '@/lib/viewerControls';

// The bar sits on the same surface as the sidebar and carries no boxes: a row of
// bordered buttons across the top of a diff reads as a form to fill in, and the
// code is what should hold the eye. Every control here is a bare glyph or a bare
// word that lifts on hover, which is how diffs-hub does it.
//
// Moving between pull requests is the left bar's job now, so what used to be a
// picker here is a label: the bar already lists every open pull request, and a
// second list of the same rows behind a menu button was one list too many.

const MARKERS: {
  icon: typeof IconCodeStyleBars;
  label: string;
  value: DiffIndicators;
}[] = [
  { icon: IconCodeStyleBars, label: 'Bars', value: 'bars' },
  // 'classic' is the library's name for the +/- signs in the gutter.
  { icon: IconSymbolDiffstat, label: 'Signs', value: 'classic' },
  { icon: IconEyeSlash, label: 'None', value: 'none' },
];

interface ReviewHeaderProps {
  codeFont: CodeFontState;
  colorMode: ColorModeState;
  controls: ViewerControls;
  /** True while the file list covers the diff. Phone layout only. */
  filesOpen?: boolean;
  onControlsChange(next: ViewerControls): void;
  /** Shows and hides the file list. Absent on every screen wide enough to
      draw the list beside the diff. */
  onToggleFiles?(): void;
  /** Called once a verdict lands, so the caller can reload what changed. */
  onReviewSubmitted?(): void;
  /** Absent unless the target is a pull request. */
  pull?: PullDetailsState;
  /** Absent unless the target is a pull request, which is the only one to
      have a review to submit. */
  review?: SubmitReviewState;
  /** True when the left bar is not on screen and the way home has to be here. */
  showBrand?: boolean;
  /** What is under review, in words. */
  targetLabel: string;
  /** The same thing on github.com. */
  targetUrl: string;
  token: GitHubTokenState;
}

export function ReviewHeader({
  codeFont,
  colorMode,
  controls,
  filesOpen = false,
  onControlsChange,
  onReviewSubmitted,
  onToggleFiles,
  pull,
  review,
  showBrand = false,
  targetLabel,
  targetUrl,
  token,
}: ReviewHeaderProps) {
  const split = controls.diffStyle === 'split';
  const [reviewing, setReviewing] = useState(false);
  // Only the phone layout scrolls this row, and the attributes it writes mean
  // nothing to any other width, so this costs a wider screen two no-op writes.
  const fadeRef = useEdgeFade<HTMLElement>();
  return (
    // On a phone this row holds more than the screen is wide, so it scrolls
    // sideways and `data-app-topbar` fades whichever end still has something
    // past it. See `[data-app-topbar]` in globals.css. `overflow-visible` on
    // every wider screen, or the menus this row opens would be clipped by
    // their own bar.
    <header
      ref={fadeRef}
      className="border-line bg-surface max-phone:gap-0.5 max-phone:overflow-x-auto max-phone:px-2 flex h-11 shrink-0 items-center gap-1 border-b px-3"
      data-app-topbar=""
    >
      {/* The two leftmost controls on a phone, in the order they open onto
          more of the app: every pull request, then every file of this one.
          Both are absent on a wider screen, which draws the bar and the file
          list as columns instead. */}
      <PullListButton className="phone:hidden shrink-0" />
      {onToggleFiles != null && (
        <Button
          aria-expanded={filesOpen}
          aria-label={filesOpen ? 'Hide the file list' : 'Show the file list'}
          className="phone:hidden shrink-0"
          size="icon"
          title={filesOpen ? 'Hide the file list' : 'Show the file list'}
          variant="chrome"
          onClick={onToggleFiles}
        >
          <IconFileTree size={15} />
        </Button>
      )}
      {showBrand && (
        <Link
          to="/"
          className="text-ink-faint hover:text-ink shrink-0 text-xs font-semibold tracking-wide uppercase"
        >
          ghdiff
        </Link>
      )}
      {/* The one place the review names itself, so it is also the way to the
          page it was taken from. */}
      <GitHubTextLink
        className="text-ink-muted shrink-0 truncate text-xs font-medium"
        href={targetUrl}
        title={`Open ${targetLabel} on GitHub`}
      >
        {targetLabel}
      </GitHubTextLink>
      {pull != null && <PullTitle pull={pull} />}

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {/* Only a pull request has a review to submit. A commit and a compare
            range have no thread on GitHub for a verdict to land in. */}
        {review != null && (
          <>
            <ReviewButton review={review} onOpen={() => setReviewing(true)} />
            <ReviewSubmitDialog
              open={reviewing}
              review={review}
              targetLabel={targetLabel}
              onClose={() => setReviewing(false)}
              onSubmitted={onReviewSubmitted}
            />
          </>
        )}
        <Button
          aria-label={split ? 'Switch to unified view' : 'Switch to split view'}
          size="icon"
          title={split ? 'Split view' : 'Unified view'}
          variant="chrome"
          onClick={() =>
            onControlsChange({
              ...controls,
              diffStyle: split ? 'unified' : 'split',
            })
          }
        >
          {split ? <IconDiffSplit size={15} /> : <IconDiffUnified size={15} />}
        </Button>
        <ColorModeToggle colorMode={colorMode} />

        {/* modal={false}, so the diff still scrolls while the menu is open and
            a setting can be judged against the code it changes. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Display settings"
              size="icon"
              title="Display settings"
              variant="chrome"
            >
              <IconGearFill size={15} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {/* First, because it is the setting that changes the most pixels.
                Every row is drawn in the face it names: what a typeface looks
                like is the whole of what the choice is about, and a list of
                names in one face asks the reviewer to remember instead. */}
            <DropdownMenuLabel>Code font</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={codeFont.font}
              onValueChange={(value) => codeFont.setFont(value as CodeFontId)}
            >
              {CODE_FONTS.map((font) => (
                <DropdownMenuRadioItem
                  key={font.id}
                  className="items-center"
                  value={font.id}
                >
                  <span
                    className="min-w-0 truncate"
                    style={{ fontFamily: font.stack }}
                  >
                    {font.label}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Change markers</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={controls.diffIndicators}
              onValueChange={(value) =>
                onControlsChange({
                  ...controls,
                  diffIndicators: value as DiffIndicators,
                })
              }
            >
              {MARKERS.map(({ icon: Icon, label, value }) => (
                <DropdownMenuRadioItem
                  key={value}
                  className="items-center"
                  value={value}
                >
                  <Icon className="text-ink-muted shrink-0" size={14} />
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>

            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={controls.overflow === 'wrap'}
              indicator="switch"
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) =>
                onControlsChange({
                  ...controls,
                  overflow: checked === true ? 'wrap' : 'scroll',
                })
              }
            >
              Wrap long lines
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={controls.lineNumbers}
              indicator="switch"
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) =>
                onControlsChange({ ...controls, lineNumbers: checked === true })
              }
            >
              Line numbers
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={controls.backgrounds}
              indicator="switch"
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) =>
                onControlsChange({ ...controls, backgrounds: checked === true })
              }
            >
              Change backgrounds
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <span aria-hidden="true" className="bg-line mx-1 h-4 w-px" />
        <GitHubTokenControl token={token} />
      </div>
    </header>
  );
}

const VERDICT_ICON: Record<ReviewVerdict, typeof IconInReview> = {
  approved: IconApproved,
  changes: IconX,
  commented: IconComment,
};

/**
 * The verdict's colour, in the tokens the status square paints with, so the
 * green on this button and the green on the square in the left bar are one
 * colour saying one thing. `pending` never reaches here — a verdict is a
 * decision already made — and it is listed because the tone vocabulary is
 * shared with the check axis, which does have a running state.
 */
const VERDICT_COLOR: Record<StatusTone, string> = {
  success: 'text-status-success',
  failure: 'text-status-failure',
  pending: 'text-status-pending',
  neutral: 'text-status-neutral',
};

/**
 * The way in to a verdict, and the report of the one already on record.
 *
 * A reviewer who approved this pull request yesterday should not be offered a
 * bare **Review**, which reads as an invitation to do what they have already
 * done. So the button says what they decided and shows it in the verdict's own
 * colour, and it still opens the same dialog: GitHub takes a second review, and
 * the newest one is the one that counts.
 */
function ReviewButton({
  onOpen,
  review,
}: {
  onOpen(): void;
  review: SubmitReviewState;
}) {
  const { latest } = review;
  const verdict = reviewVerdict(latest);

  // Also the first paint of every review, before GitHub has answered. The
  // button is pressable throughout, because the verdict on record changes what
  // it says and never what it does.
  if (latest == null || verdict == null) {
    return (
      <Button
        size="sm"
        title="Approve, request changes, or comment"
        variant="chrome"
        onClick={onOpen}
      >
        <IconInReview size={14} />
        Review
      </Button>
    );
  }

  const Icon = VERDICT_ICON[verdict.verdict];
  return (
    <Button
      size="sm"
      title={`${describeSubmittedReview(latest)} Review it again.`}
      variant="chrome"
      onClick={onOpen}
    >
      <Icon className={cn('shrink-0', VERDICT_COLOR[verdict.tone])} size={14} />
      {verdict.label}
    </Button>
  );
}

/**
 * The title of the pull request, and the way in to what it is for. It takes the
 * space between the switcher and the controls, and truncates rather than push
 * anything off the bar.
 */
function PullTitle({ pull }: { pull: PullDetailsState }) {
  // Stamped when the card opens, so the ages it shows are read from one instant
  // and no clock runs behind a closed menu.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const title = pull.data?.title;

  if (title == null) {
    return pull.loading ? (
      <span
        aria-hidden="true"
        className="bg-line/60 ml-1 h-3.5 w-48 min-w-0 animate-pulse rounded motion-reduce:animate-none"
      />
    ) : null;
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => setOpenedAt(open ? Date.now() : null)}
    >
      <DropdownMenuTrigger asChild>
        {/* `min-w-0 flex-1` so it gives its width up to the controls first and
            truncates rather than push them off. `max-phone:min-w-32` puts a
            floor under that: on a phone the row scrolls instead of shrinking,
            and a title squeezed to nothing is a control nobody can read or
            aim at — it is the way in to what the pull request is for. */}
        <Button
          className="max-phone:min-w-32 ml-1 min-w-0 flex-1 justify-start"
          size="sm"
          title={title}
          variant="chrome"
        >
          <span className="text-ink min-w-0 truncate font-medium">{title}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[min(32rem,calc(100vw-2rem))] p-0"
      >
        <PullDetailsCard
          details={pull.data}
          error={pull.error}
          loading={pull.loading}
          now={openedAt}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
