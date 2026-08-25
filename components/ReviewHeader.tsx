'use client';

import type { DiffIndicators } from '@pierre/diffs';
import Link from 'next/link';

import { ColorModeToggle } from '@/components/ColorModeToggle';
import { GitHubTokenControl } from '@/components/GitHubTokenControl';
import { PullSwitcher } from '@/components/PullSwitcher';
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
import type { WatchedReposState } from '@/hooks/useWatchedRepos';

interface ReviewHeaderProps {
  colorMode: ColorModeState;
  controls: ViewerControls;
  onControlsChange(next: ViewerControls): void;
  /** Undefined on the home page, where nothing is under review yet. */
  switcherLabel: string;
  token: GitHubTokenState;
  watched: WatchedReposState;
}

export function ReviewHeader({
  colorMode,
  controls,
  onControlsChange,
  switcherLabel,
  token,
  watched,
}: ReviewHeaderProps) {
  return (
    <header className="border-line bg-surface flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <PullSwitcher
        label={switcherLabel}
        token={token.token}
        viewerLogin={token.viewer?.login}
        watched={watched}
      />
      <Link
        href="/"
        className="text-ink-faint hover:text-ink ml-1 text-xs font-semibold tracking-wide uppercase"
      >
        reviewer
      </Link>

      <div className="ml-auto flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              View
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Layout</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={controls.diffStyle}
              onValueChange={(value) =>
                onControlsChange({
                  ...controls,
                  diffStyle: value as ViewerControls['diffStyle'],
                })
              }
            >
              <DropdownMenuRadioItem value="split">Split</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="unified">
                Unified
              </DropdownMenuRadioItem>
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
              <DropdownMenuRadioItem value="bars">Bars</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="signs">Signs</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="none">None</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>

            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={controls.overflow === 'wrap'}
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
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) =>
                onControlsChange({ ...controls, lineNumbers: checked === true })
              }
            >
              Line numbers
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={controls.backgrounds}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) =>
                onControlsChange({ ...controls, backgrounds: checked === true })
              }
            >
              Change backgrounds
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ColorModeToggle colorMode={colorMode} />
        <GitHubTokenControl token={token} />
      </div>
    </header>
  );
}
