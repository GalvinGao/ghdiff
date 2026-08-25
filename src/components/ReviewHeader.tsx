import type { DiffIndicators } from '@pierre/diffs';
import {
  IconCodeStyleBars,
  IconDiffSplit,
  IconDiffUnified,
  IconEyeSlash,
  IconGearFill,
  IconSymbolDiffstat,
} from '@pierre/icons';
import { useState } from 'react';

import { ColorModeToggle } from '@/components/ColorModeToggle';
import { GitHubTokenControl } from '@/components/GitHubTokenControl';
import { PullDetailsCard } from '@/components/PullDetailsCard';
import type { ViewerControls } from '@/components/ReviewViewer';
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
import type { ColorModeState } from '@/hooks/useColorMode';
import type { GitHubTokenState } from '@/hooks/useGitHubToken';
import type { PullDetailsState } from '@/hooks/usePullDetails';

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
  colorMode: ColorModeState;
  controls: ViewerControls;
  onControlsChange(next: ViewerControls): void;
  /** Absent unless the target is a pull request. */
  pull?: PullDetailsState;
  /** What is under review, in words. */
  targetLabel: string;
  token: GitHubTokenState;
}

export function ReviewHeader({
  colorMode,
  controls,
  onControlsChange,
  pull,
  targetLabel,
  token,
}: ReviewHeaderProps) {
  const split = controls.diffStyle === 'split';
  return (
    <header className="border-line bg-surface flex h-11 shrink-0 items-center gap-1 border-b px-3">
      <span
        className="text-ink-muted shrink-0 truncate text-xs font-medium"
        title={targetLabel}
      >
        {targetLabel}
      </span>
      {pull != null && <PullTitle pull={pull} />}

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
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
        <Button
          className="ml-1 min-w-0 flex-1 justify-start"
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
