import { GitPullRequestIcon } from '@primer/octicons-react/GitPullRequestIcon';
import { PeopleIcon } from '@primer/octicons-react/PeopleIcon';
import { PersonFillIcon } from '@primer/octicons-react/PersonFillIcon';
import { StackIcon } from '@primer/octicons-react/StackIcon';
import { type ComponentType, type KeyboardEvent, useRef } from 'react';

import { m } from '../paraglide/messages.js';
import { SkeletonBar } from '@/components/ui/SkeletonBar';
import { Tooltip } from '@/components/ui/Tooltip';
import type { OpenPullsState } from '@/hooks/useOpenPulls';
import { usePullScope } from '@/hooks/usePullScope';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/locale';
import type { PullScope } from '@/lib/pullScope';
import type { GitHubPullTarget } from '@/lib/reviewTarget';

// Which pull requests the list draws, as tabs with a count each.
//
// Tabs, not toggles: one is always chosen, and All is a tab of its own rather
// than what is left when nothing is pressed. A toggle that undid itself on a
// second press left the reviewer to work out that a row of unpressed buttons
// meant everything.
//
// Two frames, because the tabs answer two questions. All, Mine and Others are
// the list by author — Mine and Others split All between them, which is why the
// three share one frame. This Stack is a question about the pull request on
// screen, is there only while that pull request has a stack, and sits apart so
// its arrival does not read as a fourth way of splitting the list. Both frames
// are one tab list, so the arrow keys cross from one to the other.
//
// The glyphs are octicons, the family the pull request state icons already come
// from, so the four read as one set. GitHub has no glyph for "my pull
// requests", so Mine and Others are composed: the pull request glyph with a
// person in its corner, solid for the viewer and the outlined pair for
// everybody else. All is the pull request glyph alone. The corner is cut out of
// the pull request glyph with a mask rather than a ring painted in the
// background colour, because the tab behind it changes colour when it is
// chosen and a painted ring would not.
//
// In the bar's header the row may be narrower than the four tabs, and
// `useRowFit` there decides how much of them to draw: `tight` takes the
// padding in, `lean` keeps All's count for a screen reader alone, and `bare`
// does the same for the rest. They are read off the header's `data-fit`
// through the `rail-header` group, so the switch in the phone's sheet, which
// has no such header, is always drawn whole.

type Size = 'default' | 'touch';

interface PullScopeSwitchProps {
  className?: string;
  current?: GitHubPullTarget;
  /** `touch` for the phone's sheet, where a press is a fingertip. */
  size?: Size;
  state: OpenPullsState;
}

export function PullScopeSwitch({
  className,
  current,
  size = 'default',
  state,
}: PullScopeSwitchProps) {
  const { counts, scope, setScope, tabs, waiting } = usePullScope(
    state,
    current
  );
  const listRef = useRef<HTMLDivElement>(null);
  if (waiting != null) {
    return waiting.tabs.length < 2 ? null : (
      <ScopeSkeleton className={className} size={size} waiting={waiting} />
    );
  }
  if (tabs.length < 2) return null;

  const tabFor = (value: PullScope) => {
    const tab = TABS[value];
    const count =
      value === 'all'
        ? counts.mine + counts.others
        : value === 'stack'
          ? (counts.stack?.length ?? 0)
          : counts[value];
    return (
      <ScopeTab
        key={value}
        count={count}
        glyph={tab.glyph}
        redundant={value === 'all'}
        label={tab.label()}
        selected={scope === value}
        size={size}
        tooltipSide={value === 'stack' ? 'bottom-end' : 'bottom'}
        onSelect={() => setScope(value)}
      />
    );
  };

  // The arrow keys move between the tabs and choose as they go, the way a tab
  // list does, and skip a tab with nothing in it. Home and End go to the ends.
  // The direction is the row's own, so the right arrow is the next tab in a
  // row laid out left to right and the previous one in a row laid out right to
  // left.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = listRef.current;
    if (list == null) return;
    const enabled = [
      ...list.querySelectorAll<HTMLButtonElement>('[role="tab"]:enabled'),
    ];
    const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const forward = getComputedStyle(list).direction === 'rtl' ? -1 : 1;
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    else if (event.key === 'ArrowRight') next = at + forward;
    else if (event.key === 'ArrowLeft') next = at - forward;
    else return;
    next = (next + enabled.length) % enabled.length;
    event.preventDefault();
    enabled[next].focus();
    enabled[next].click();
  };

  const authorTabs = tabs.filter((value) => value !== 'stack');
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={m.pull_scope_switch_which_pull_requests()}
      className={cn(
        'flex shrink-0 items-center gap-1.5',
        size !== 'touch' && 'group-[[data-fit~=tight]]/rail-header:gap-1',
        className
      )}
      onKeyDown={onKeyDown}
    >
      <div className={FRAME_CLASS}>{authorTabs.map(tabFor)}</div>
      {tabs.includes('stack') && (
        <div className={FRAME_CLASS}>{tabFor('stack')}</div>
      )}
    </div>
  );
}

/** A scope's name: its tab's label, and the title of the sheet it fills. */
export function pullScopeLabel(scope: PullScope): string {
  return TABS[scope].label();
}

/**
 * The tabs before the list has arrived, in the shape the answer is expected
 * to take: the same frames, the same tabs at the same size, and the expected
 * choice already lifted, with a bar where each count will be. The list under
 * it draws a skeleton for the same wait, and a switch that appeared only once
 * the list did pushed every row of that skeleton down as it arrived.
 */
function ScopeSkeleton({
  className,
  size,
  waiting,
}: {
  className?: string;
  size: Size;
  waiting: { scope: PullScope; tabs: readonly PullScope[] };
}) {
  const tab = (value: PullScope) => {
    const Glyph = TABS[value].glyph;
    return (
      <span
        key={value}
        className={cn(
          'inline-flex shrink-0 items-center rounded-md border',
          size === 'touch'
            ? 'h-8 gap-1.5 px-2'
            : 'h-6 gap-1 px-1.5 group-[[data-fit~=tight]]/rail-header:gap-0.5 group-[[data-fit~=tight]]/rail-header:px-1',
          value === waiting.scope
            ? 'border-line bg-raised text-ink-faint shadow-sm'
            : 'text-ink-faint/60 border-transparent'
        )}
      >
        <Glyph />
        {/* Two digits wide, which is the count most lists have. */}
        <SkeletonBar className="h-2.5 w-[2ch] group-[[data-fit~=bare]]/rail-header:hidden" />
      </span>
    );
  };
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex shrink-0 animate-pulse items-center gap-1.5 motion-reduce:animate-none',
        size !== 'touch' && 'group-[[data-fit~=tight]]/rail-header:gap-1',
        className
      )}
    >
      <div className={FRAME_CLASS}>
        {waiting.tabs.filter((value) => value !== 'stack').map(tab)}
      </div>
      {waiting.tabs.includes('stack') && (
        <div className={FRAME_CLASS}>{tab('stack')}</div>
      )}
    </div>
  );
}

// Called at render time, never at module load: a message read once would hold
// the locale of the first request for every request after it.
const TABS: Record<PullScope, { glyph: ComponentType; label(): string }> = {
  all: { glyph: AllGlyph, label: () => m.pull_scope_switch_all() },
  mine: { glyph: MineGlyph, label: () => m.pull_scope_switch_mine() },
  others: { glyph: OthersGlyph, label: () => m.pull_scope_switch_others() },
  stack: { glyph: StackGlyph, label: () => m.pull_scope_switch_this_stack() },
};

// The frame `Segmented` draws, so a set of tabs looks the same here as the
// comment author filter does.
const FRAME_CLASS =
  'border-line bg-surface inline-flex items-center gap-0.5 rounded-lg border p-0.5';

function ScopeTab({
  count,
  glyph: Glyph,
  label,
  onSelect,
  redundant,
  selected,
  size,
  tooltipSide,
}: {
  count: number;
  glyph: ComponentType;
  label: string;
  onSelect(): void;
  /** A count the tabs beside it add up to, and the first to go for room. */
  redundant: boolean;
  selected: boolean;
  size: Size;
  tooltipSide: 'bottom' | 'bottom-end';
}) {
  // A scope with nothing in it is a tab that empties the list. It stays
  // choosable while it is the one chosen, so a stored choice is never a tab the
  // reviewer cannot see is on.
  const disabled = count === 0 && !selected;
  const tab = (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      // One tab in the order, the chosen one; the arrow keys reach the rest.
      tabIndex={selected ? 0 : -1}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center rounded-md border',
        'transition-[background-color,border-color,color,box-shadow]',
        'focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none',
        'disabled:cursor-default disabled:opacity-40',
        size === 'touch'
          ? 'h-8 gap-1.5 px-2'
          : 'h-6 gap-1 px-1.5 group-[[data-fit~=tight]]/rail-header:gap-0.5 group-[[data-fit~=tight]]/rail-header:px-1',
        selected
          ? 'border-line bg-raised text-ink shadow-sm'
          : 'text-ink-muted enabled:hover:bg-raised enabled:hover:text-ink border-transparent'
      )}
      disabled={disabled}
      onClick={onSelect}
    >
      <Glyph />
      {/* The name is read and not drawn, so the tab's accessible name is the
          scope and then its count, in whatever words the locale has for it. */}
      <span className="sr-only">{label}</span>
      {/* At least one digit wide, so a count that arrives late does not move
          the glyph beside it. Hidden from sight and not from a screen reader
          when the bar is too narrow to draw it. */}
      <span
        className={cn(
          'min-w-[1ch] text-[11px] leading-none font-medium tabular-nums',
          'group-[[data-fit~=bare]]/rail-header:sr-only',
          redundant && 'group-[[data-fit~=lean]]/rail-header:sr-only'
        )}
      >
        {formatNumber(count)}
      </span>
    </button>
  );
  // Every tab names itself on hover, in the sheet as well as the bar: the
  // glyphs are the whole of what is drawn, and a narrow desktop window gets the
  // sheet too. A tap leaves no label behind, because Tailwind only applies a
  // hover where the device can hover.
  return (
    <Tooltip label={label} side={tooltipSide}>
      {tab}
    </Tooltip>
  );
}

// The pull request glyph at 14, and a 10px person over its lower right corner.
// The box is wider than the pull request glyph by the four pixels the badge
// reaches past it, so the badge never overlaps the count beside it.
const BOX = { width: 18, height: 16 } as const;
const PR_SIZE = 14;
const BADGE_SIZE = 10;
// The hole around the badge: its radius and a pixel and a quarter of air,
// centred on the badge in the pull request glyph's own pixels.
const CUTOUT = `radial-gradient(circle ${String(BADGE_SIZE / 2 + 1.25)}px at ${String(BOX.width - BADGE_SIZE / 2)}px ${String(BOX.height - BADGE_SIZE / 2)}px, transparent 98%, #000 100%)`;

function ComposedGlyph({
  badge: Badge,
}: {
  badge: ComponentType<{ size: number }>;
}) {
  return (
    <span
      aria-hidden="true"
      className="relative inline-block shrink-0"
      style={BOX}
    >
      <span
        className="absolute top-0 left-0 flex"
        style={{ maskImage: CUTOUT, WebkitMaskImage: CUTOUT }}
      >
        <GitPullRequestIcon size={PR_SIZE} />
      </span>
      <span className="absolute right-0 bottom-0 flex">
        <Badge size={BADGE_SIZE} />
      </span>
    </span>
  );
}

function MineGlyph() {
  return <ComposedGlyph badge={PersonFillIcon} />;
}

function OthersGlyph() {
  return <ComposedGlyph badge={PeopleIcon} />;
}

// All and the stack have no badge, and so no box wider than the glyph: centred
// in the same height as the other two, they sit on one line with them.
function SingleGlyph({
  icon: Icon,
}: {
  icon: ComponentType<{ size: number }>;
}) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center"
      style={{ height: BOX.height }}
    >
      <Icon size={PR_SIZE} />
    </span>
  );
}

function AllGlyph() {
  return <SingleGlyph icon={GitPullRequestIcon} />;
}

function StackGlyph() {
  return <SingleGlyph icon={StackIcon} />;
}
