'use client';

import type { GitStatus } from '@pierre/trees';
import { useMemo } from 'react';

import { Button } from '@/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { cn } from '@/lib/cn';
import {
  DEFAULT_FILTER_PRESET_ID,
  FILTER_PRESETS,
  type FilterPresetId,
} from '@/lib/filterRules';
import type { ReviewFileEntry } from '@/lib/reviewData';
import {
  EMPTY_FILTER_STATE,
  EMPTY_PRESET_STAT,
  isFilterActive,
  type PresetStat,
  presetStats,
  type ReviewFilterState,
} from '@/lib/reviewFilter';

// Status colors match the values the tree's own stylesheet uses, so a badge
// here reads the same as the badge on the row.
const STATUS_ITEMS: {
  status: GitStatus;
  label: string;
  short: string;
  color: string;
}[] = [
  {
    status: 'added',
    label: 'Added',
    short: 'A',
    color: 'light-dark(#16a994, #00cab1)',
  },
  {
    status: 'modified',
    label: 'Modified',
    short: 'M',
    color: 'light-dark(#1ca1c7, #08c0ef)',
  },
  {
    status: 'renamed',
    label: 'Renamed',
    short: 'R',
    color: 'light-dark(#d5a910, #ffd452)',
  },
  {
    status: 'deleted',
    label: 'Deleted',
    short: 'D',
    color: 'light-dark(#ff2e3f, #ff6762)',
  },
];

interface FilterMenuProps {
  availableStatuses: ReadonlySet<GitStatus>;
  entries: readonly ReviewFileEntry[];
  hiddenCount: number;
  onChange(next: ReviewFilterState): void;
  state: ReviewFilterState;
}

export function FilterMenu({
  availableStatuses,
  entries,
  hiddenCount,
  onChange,
  state,
}: FilterMenuProps) {
  const presetIds = useMemo(
    () => FILTER_PRESETS.map((preset) => preset.id),
    []
  );
  const stats = useMemo(
    () => presetStats(entries, presetIds),
    [entries, presetIds]
  );
  const active = isFilterActive(state);
  const statusItems = STATUS_ITEMS.filter((item) =>
    availableStatuses.has(item.status)
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={active ? 'outline' : 'ghost'}
          size="sm"
          aria-label="Filter files"
          aria-pressed={active}
          className="gap-1.5"
        >
          <FilterGlyph />
          <span>{activeLabel(state)}</span>
          {hiddenCount > 0 && (
            <span className="text-ink-faint tabular-nums">
              {hiddenCount} hidden
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[27rem]">
        <DropdownMenuLabel>File rules</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={state.presetId}
          onValueChange={(value) =>
            onChange({ ...state, presetId: value as FilterPresetId })
          }
        >
          {FILTER_PRESETS.map((preset) => {
            const stat = stats.get(preset.id) ?? EMPTY_PRESET_STAT;
            return (
              <DropdownMenuRadioItem
                key={preset.id}
                value={preset.id}
                // A preset that would empty the list is offered but marked, so
                // the reviewer does not pick it and see a blank pane.
                disabled={
                  stat.files === 0 && preset.id !== DEFAULT_FILTER_PRESET_ID
                }
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-3">
                    <span className="text-ink font-medium whitespace-nowrap">
                      {preset.label}
                    </span>
                    <PresetStatLine className="ml-auto" stat={stat} />
                  </span>
                  <span className="text-ink-faint block text-xs whitespace-nowrap">
                    {preset.description}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>

        {statusItems.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Git status</DropdownMenuLabel>
            {statusItems.map((item) => (
              <DropdownMenuCheckboxItem
                key={item.status}
                checked={state.statuses.has(item.status)}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => {
                  const next = new Set(state.statuses);
                  if (next.has(item.status)) {
                    next.delete(item.status);
                  } else {
                    next.add(item.status);
                  }
                  onChange({ ...state, statuses: next });
                }}
              >
                <span
                  className="w-4 shrink-0 rounded-sm text-center font-mono text-xs font-semibold"
                  style={{
                    color: item.color,
                    backgroundColor: `color-mix(in srgb, ${item.color} 15%, transparent)`,
                  }}
                >
                  {item.short}
                </span>
                {item.label}
              </DropdownMenuCheckboxItem>
            ))}
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!active}
          onSelect={() => onChange(EMPTY_FILTER_STATE)}
        >
          Clear every filter
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Files, then lines added and deleted. It sits on one line and never wraps, so
 * the rows stay scannable as a column of numbers.
 */
function PresetStatLine({
  className,
  stat,
}: {
  className?: string;
  stat: PresetStat;
}) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-baseline gap-2 text-xs tabular-nums whitespace-nowrap',
        className
      )}
    >
      <span className="text-ink-faint">
        {stat.files} {stat.files === 1 ? 'file' : 'files'}
      </span>
      <span className="text-added">+{stat.addedLines}</span>
      <span className="text-removed">-{stat.deletedLines}</span>
    </span>
  );
}

function activeLabel(state: ReviewFilterState): string {
  const preset = FILTER_PRESETS.find((item) => item.id === state.presetId);
  const base = preset?.label ?? 'All files';
  if (state.statuses.size > 0) {
    return `${base} · ${state.statuses.size} status`;
  }
  return base;
}

function FilterGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn('size-3.5 fill-none stroke-current stroke-[1.4]')}
    >
      <path d="M2.5 4h11M4.5 8h7M6.5 12h3" strokeLinecap="round" />
    </svg>
  );
}
