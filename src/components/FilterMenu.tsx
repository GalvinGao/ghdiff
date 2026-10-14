import { IconFilter, IconXSquircle } from '@pierre/icons';
import type { GitStatus } from '@pierre/trees';
import { useMemo } from 'react';

import { m } from '../paraglide/messages.js';
import { Button } from '@/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { cn } from '@/lib/cn';
import { FILTER_PRESETS, NO_PRESETS, togglePreset } from '@/lib/filterRules';
import { formatList } from '@/lib/locale';
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
    get label() {
      return m.filter_menu_added();
    },
    short: 'A',
    color: 'light-dark(#16a994, #00cab1)',
  },
  {
    status: 'modified',
    get label() {
      return m.filter_menu_modified();
    },
    short: 'M',
    color: 'light-dark(#1ca1c7, #08c0ef)',
  },
  {
    status: 'renamed',
    get label() {
      return m.filter_menu_renamed();
    },
    short: 'R',
    color: 'light-dark(#d5a910, #ffd452)',
  },
  {
    status: 'deleted',
    get label() {
      return m.filter_menu_deleted();
    },
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
  const allStat = useMemo<PresetStat>(
    () => ({
      files: entries.length,
      addedLines: entries.reduce((sum, entry) => sum + entry.addedLines, 0),
      deletedLines: entries.reduce((sum, entry) => sum + entry.deletedLines, 0),
    }),
    [entries]
  );
  const active = isFilterActive(state);
  const statusItems = STATUS_ITEMS.filter((item) =>
    availableStatuses.has(item.status)
  );

  return (
    // modal={false}, so a filter can be judged against the diff it is filtering
    // instead of freezing it behind the menu.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {/* A filter that is hiding files must be obvious, but this sits above
            the file tree all review long: an accent border and an accent count
            say it without a saturated bar across the panel. */}
        <Button
          variant="outline"
          size="sm"
          aria-label={m.filter_menu_filter_files()}
          className={cn('w-full', active && 'border-accent/70')}
        >
          <IconFilter
            className={active ? 'text-accent' : 'text-ink-faint'}
            size={13}
          />
          {/* The word says what the control is; the value after it is what the
              filter is set to, and only that half reads as ink. */}
          <span className="truncate">
            <span className="text-ink-faint me-1">
              {m.filter_menu_prefix()}
            </span>
            {activeLabel(state)}
          </span>
          {hiddenCount > 0 && (
            <span className="text-accent ml-auto shrink-0 tabular-nums">
              {m.filter_hidden_count({ count: hiddenCount })}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      {/* The menu is as wide as the control that opened it, which is the width
          of the sidebar. It reaches over the diff only when the sidebar is
          narrower than the rows can survive. */}
      <DropdownMenuContent
        align="start"
        className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-64"
      >
        <DropdownMenuLabel>{m.filter_menu_file_rules()}</DropdownMenuLabel>
        {/* Two answers to one question: every file, or the kinds picked
            below. "All files" is a tick because it is one choice; the kinds
            are boxes because they add up. Picking a kind leaves "All files",
            and pressing it again clears every box. */}
        <DropdownMenuCheckboxItem
          className="items-start"
          checked={state.presetIds.size === 0}
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={() => onChange({ ...state, presetIds: NO_PRESETS })}
        >
          <PresetRow
            label={m.filter_rules_all_files()}
            description={m.filter_rules_show_every_file_in_the_diff()}
            stat={allStat}
          />
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {FILTER_PRESETS.map((preset) => {
          const stat = stats.get(preset.id) ?? EMPTY_PRESET_STAT;
          const checked = state.presetIds.has(preset.id);
          return (
            <DropdownMenuCheckboxItem
              key={preset.id}
              className="items-start"
              indicator="checkbox"
              checked={checked}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={() =>
                onChange({
                  ...state,
                  presetIds: togglePreset(state.presetIds, preset.id),
                })
              }
              // A kind this diff has none of is offered but marked, so the
              // reviewer does not tick it and wonder why nothing arrived. One
              // already ticked stays pressable, or it could not be taken off.
              disabled={stat.files === 0 && !checked}
            >
              <PresetRow
                label={preset.label}
                description={preset.description}
                stat={stat}
              />
            </DropdownMenuCheckboxItem>
          );
        })}

        {statusItems.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{m.filter_menu_git_status()}</DropdownMenuLabel>
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
          <IconXSquircle className="opacity-60" size={14} />
          {m.filter_menu_clear_filters()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A kind's name and its size on one line, and what it is under them. */
function PresetRow({
  description,
  label,
  stat,
}: {
  description: string;
  label: string;
  stat: PresetStat;
}) {
  return (
    <span className="min-w-0 flex-1">
      {/* Wraps rather than widens: at a narrow width the counts drop to their
          own line instead of pushing the menu out over the diff. */}
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="text-ink font-medium whitespace-nowrap">{label}</span>
        <PresetStatLine className="ml-auto" stat={stat} />
      </span>
      <span className="text-ink-faint mt-0.5 block text-xs">{description}</span>
    </span>
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
        {m.common_file_count({ count: stat.files })}
      </span>
      <span className="text-added">+{stat.addedLines}</span>
      <span className="text-removed">-{stat.deletedLines}</span>
    </span>
  );
}

function activeLabel(state: ReviewFilterState): string {
  const picked = FILTER_PRESETS.filter((item) =>
    state.presetIds.has(item.id)
  ).map((item) => item.label);
  const base =
    picked.length === 0 ? m.filter_menu_all_files() : formatList(picked);
  if (state.statuses.size > 0) {
    return m.filter_status_summary({ base, count: state.statuses.size });
  }
  return base;
}
