import {
  IconReload,
  IconSidebarLeft,
  IconSidebarLeftOpen,
} from '@pierre/icons';
import { Link } from '@tanstack/react-router';
import { type Ref, useMemo, useRef, useState } from 'react';

import { useAppData } from '@/components/AppDataProvider';
import { PaneResizeHandle } from '@/components/PaneResizeHandle';
import { PullRequestList } from '@/components/PullRequestList';
import { isCurrentPull } from '@/components/PullRow';
import { PullStackBadge } from '@/components/PullStackBadge';
import { PullStatusMark } from '@/components/PullStatusMark';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { Tooltip } from '@/components/ui/Tooltip';
import { WatchedReposDialog } from '@/components/WatchedReposDialog';
import { railCollapsedPreference, usePreference } from '@/hooks/preferences';
import { useCurrentPull } from '@/hooks/useCurrentPull';
import type { OpenPullsState } from '@/hooks/useOpenPulls';
import {
  RAIL_TOGGLE_FLIP_KEY,
  RAIL_TRANSITION_EASING,
  RAIL_TRANSITION_MS,
  railPullFlipKey,
  railStackFlipKey,
  useRailFlip,
} from '@/hooks/useRailFlip';
import {
  RAIL_MAX_WIDTH,
  RAIL_MIN_WIDTH,
  RAIL_WIDTH_PROPERTY,
  useRailWidth,
} from '@/hooks/useRailWidth';
import { cn } from '@/lib/cn';
import {
  flattenStacks,
  groupPullsByRepo,
  type PullSummary,
  type WatchedRepo,
} from '@/lib/pulls';
import { type GitHubPullTarget, reviewTargetSplat } from '@/lib/reviewTarget';

// The left-most bar, on every page. Reviewing is moving between pull requests,
// so the list of them is not a menu the reviewer opens: it is the edge of the
// app, and the diff sits inside it.
//
// The bar reads the pull request on screen out of the path rather than being
// told, so it works the same above the home page, a review, and a 404.
//
// With no repository on the watch list the bar has no list to be, so it does not
// render at all: an empty column beside a diff is a promise the app cannot keep.
// The home page owns the watch list and every screen keeps a way back to it, so
// nothing is out of reach while the bar is away. The test is `hydrated`, not
// `repos.length` alone, because browser storage is read after mount and an
// unread watch list looks empty.
//
// That leaves one paint this test cannot reach. The bar's markup is in the
// server's answer, and the browser draws it before any effect runs, so a
// reviewer who watches nothing saw the bar and then saw it go.
// `WatchedReposScript` settles the same question in the document head and the
// rule on `[data-app-rail]` in globals.css keeps that paint empty. The hook's
// answer arrives after it and agrees with it.

// Wide enough for the squares and their padding, and nothing else to size.
const COLLAPSED_WIDTH = '2.75rem';

export function PullRail() {
  const { pulls, watched } = useAppData();
  const [editing, setEditing] = useState(false);
  const { value: collapsed, setValue: setCollapsed } = usePreference(
    railCollapsedPreference
  );
  const current = useCurrentPull();
  // Destructured, so nothing reads a property of the state object while this
  // component renders.
  const {
    attach: attachRail,
    onHandleKeyDown: onRailHandleKeyDown,
    onHandlePointerDown: onRailHandlePointerDown,
    reset: resetRailWidth,
    style: railStyle,
    width: railWidth,
  } = useRailWidth();

  const asideRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { ghost, beginToggle, clearGhost } = useRailFlip({
    asideRef,
    collapsed,
    currentKey: current == null ? undefined : railPullFlipKey(current),
    scrollRef,
  });

  // The capture must read the layout being left, so it comes first. Only this
  // handler animates: a toggle arriving from storage on another page's press
  // has no on-screen "before" to fly from.
  const toggleCollapsed = () => {
    beginToggle();
    setCollapsed(!collapsed);
  };

  if (watched.hydrated && watched.repos.length === 0) {
    return null;
  }

  return (
    <>
      <aside
        ref={(node) => {
          asideRef.current = node;
          attachRail(node);
        }}
        aria-label="Open pull requests"
        // `relative`, because the seam hangs off this element's own right edge
        // rather than taking a column of its own. The width is a custom
        // property, because the drag writes that property straight onto this
        // element and re-renders nothing. See hooks/usePaneWidth.ts.
        // The collapse and the expand travel, because the bar taking half the
        // window away in one frame reads as the page breaking rather than as
        // the reviewer's own press. The duration and the curve come from
        // useRailFlip's constants: the ghost's fade states the same two
        // numbers, and the flying squares read the width itself, so this
        // transition is the one clock every part of the toggle follows.
        // A drag must not travel: `usePaneWidth`
        // repaints the custom property on every pointermove, and a transition
        // would leave the bar behind the pointer. The handle carries
        // `data-resizing` for the length of the drag, and it is a child of this
        // element, so `has-` is the whole test.
        // `max-phone:hidden`: a phone has no column to spare beside a diff —
        // 272px of an iPhone's 402 leaves 130 for the review — so below that
        // width the bar is not drawn at all and `PullListButton` stands in for
        // it from the leftmost control on the screen. Hidden rather than
        // unmounted, so the width, the collapse and the scroll a reviewer left
        // it at are all still there when the window widens again.
        className={cn(
          'border-line bg-surface relative flex h-full shrink-0 flex-col border-r',
          'max-phone:hidden',
          'transition-[width]',
          'has-[[data-resizing]]:transition-none motion-reduce:transition-none'
        )}
        data-app-rail=""
        style={{
          ...railStyle,
          transitionDuration: `${String(RAIL_TRANSITION_MS)}ms`,
          transitionTimingFunction: RAIL_TRANSITION_EASING,
          width: collapsed ? COLLAPSED_WIDTH : `var(${RAIL_WIDTH_PROPERTY})`,
        }}
      >
        <RailContent
          collapsed={collapsed}
          current={current}
          hydrated={watched.hydrated}
          pulls={pulls}
          repos={watched.repos}
          scrollRef={scrollRef}
          onEdit={() => setEditing(true)}
          onToggle={toggleCollapsed}
        />

        {/* The layout being left, opaque over the one arriving, fading for the
            width's own 200 ms while the squares fly between the two. It copies
            the width and the scroll it was read at: the aside under it is
            already travelling, and the copy does not scroll. `inert`, because
            it is a picture — its links and buttons are the live layout's to
            answer. It ends itself: rail-ghost-fade fires animationend, and a
            missed end leaves it invisible and inert rather than in the way. */}
        {ghost != null && (
          <div
            key={ghost.generation}
            data-rail-ghost=""
            inert
            className="bg-surface pointer-events-none absolute inset-0 z-10 overflow-hidden"
            style={{ animationDuration: `${String(RAIL_TRANSITION_MS)}ms` }}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget) clearGhost();
            }}
          >
            <div
              className="flex h-full flex-col"
              style={{ width: ghost.width }}
            >
              <RailContent
                collapsed={ghost.collapsed}
                current={current}
                ghost={{ scrollTop: ghost.scrollTop }}
                hydrated={watched.hydrated}
                pulls={pulls}
                repos={watched.repos}
                onEdit={() => setEditing(true)}
                onToggle={toggleCollapsed}
              />
            </div>
          </div>
        )}

        {/* The collapsed bar is the width of one square, and a square is not a
            thing to resize. */}
        {!collapsed && (
          <PaneResizeHandle
            label="Pull request bar width"
            max={RAIL_MAX_WIDTH}
            min={RAIL_MIN_WIDTH}
            onKeyDown={onRailHandleKeyDown}
            onPointerDown={onRailHandlePointerDown}
            onReset={resetRailWidth}
            style={{ right: -4 }}
            width={railWidth}
          />
        )}
      </aside>

      <WatchedReposDialog
        open={editing}
        watched={watched}
        onClose={() => {
          setEditing(false);
          pulls.reload();
        }}
      />
    </>
  );
}

interface RailContentProps {
  collapsed: boolean;
  current?: GitHubPullTarget;
  /**
   * Present on the ghost — the fading copy of the layout being left. The copy
   * clips instead of scrolling, and carries the scroll it was read at as a
   * transform, so it shows the pixels the reviewer was looking at.
   */
  ghost?: { scrollTop: number };
  hydrated: boolean;
  onEdit(): void;
  onToggle(): void;
  pulls: OpenPullsState;
  repos: readonly WatchedRepo[];
  scrollRef?: Ref<HTMLDivElement>;
}

/**
 * Everything inside the bar: the header, the list, and the footer. One
 * component rather than markup inline in `PullRail`, because the ghost is a
 * second rendering of exactly this, and a copy that drifted from the original
 * would crossfade into a layout the bar never shows.
 */
function RailContent({
  collapsed,
  current,
  ghost,
  hydrated,
  onEdit,
  onToggle,
  pulls,
  repos,
  scrollRef,
}: RailContentProps) {
  const collapseLabel = collapsed
    ? 'Show the pull requests'
    : 'Hide the pull requests';
  return (
    <>
      <div
        className={cn(
          'border-line flex h-11 shrink-0 items-center border-b',
          collapsed ? 'justify-center px-1' : 'gap-1 px-2'
        )}
      >
        {!collapsed && (
          <Link
            to="/"
            className="text-ink-faint hover:text-ink min-w-0 truncate px-1 text-xs font-semibold tracking-wide uppercase"
          >
            ghdiff
          </Link>
        )}
        <Tooltip
          className={collapsed ? undefined : 'ml-auto'}
          label={collapseLabel}
          side={collapsed ? 'right' : 'bottom'}
        >
          {/* Marked to fly: the press that toggles the bar moves this very
              button between the wide bar's corner and the narrow bar's centre,
              and a button that teleports out from under the pointer reads as a
              second, different control. */}
          <Button
            aria-label={collapseLabel}
            data-rail-flip={RAIL_TOGGLE_FLIP_KEY}
            size="icon-sm"
            variant="chrome"
            onClick={onToggle}
          >
            {collapsed ? (
              <IconSidebarLeftOpen size={15} />
            ) : (
              <IconSidebarLeft size={15} />
            )}
          </Button>
        </Tooltip>
      </div>

      {/* `overflow-x-hidden` on the live region: a square's flight starts as a
          transform reaching to where the other layout held it, and a transform
          extends scrollable overflow — without this the flight itself would
          summon a horizontal scrollbar for its 200 ms. */}
      <div
        ref={scrollRef}
        className={cn(
          'min-h-0 flex-1',
          ghost
            ? 'overflow-hidden'
            : 'overflow-x-hidden overflow-y-auto overscroll-contain'
        )}
      >
        <div
          style={
            ghost == null || ghost.scrollTop === 0
              ? undefined
              : { transform: `translateY(${String(-ghost.scrollTop)}px)` }
          }
        >
          {collapsed ? (
            <CollapsedMarks current={current} state={pulls} />
          ) : (
            <div className="px-1 pb-2">
              <PullRequestList
                current={current}
                hydrated={hydrated}
                repos={repos}
                state={pulls}
              />
            </div>
          )}
        </div>
      </div>

      {/* `overflow-hidden` on the row below, for the 200 ms the bar spends
          between its two widths. Both buttons in it are `shrink-0`, so a row
          narrower than the two of them puts them outside the bar and over the
          diff. The rows above clip already: the list scrolls, and the
          header's own name truncates. */}
      {!collapsed && (
        // The foot of this bar and the foot of the review sidebar are one
        // rule across the screen, so this strip states the same height the
        // sidebar's strip states. `p-1` around a 28px button measured 36px
        // and the border took it to 37, a pixel taller than the sidebar's
        // `h-9` — which counts its own border — so the rule stepped at the
        // seam between the two panes.
        <div className="border-line flex h-9 shrink-0 items-center gap-1 overflow-hidden border-t px-1">
          <Button
            className="min-w-0"
            size="sm"
            variant="chrome"
            onClick={onEdit}
          >
            <span className="truncate">Watched repos</span>
          </Button>
          <Button
            aria-label="Reload the pull requests"
            className="ml-auto"
            disabled={pulls.loading}
            size="icon-sm"
            title="Reload the pull requests"
            variant="chrome"
            onClick={pulls.reload}
          >
            {/* `Spinner` is the app's one turning glyph, so a reload that is
                under way looks the same here as beside a list. */}
            {pulls.loading ? (
              <Spinner label="Loading the pull requests" size={14} />
            ) : (
              <IconReload size={14} />
            )}
          </Button>
        </div>
      )}
    </>
  );
}

/** One author's pull requests in the narrow bar: their stacks, in bar order. */
interface CollapsedGroup {
  key: string;
  stacks: { key: string; root: PullSummary; pulls: PullSummary[] }[];
}

/**
 * The collapsed bar. Every open pull request keeps its square, in the same
 * order, so the column still answers the question the bar exists for: is
 * anything red.
 *
 * It also keeps the two groupings the wide bar draws with words. A stack sits on
 * a block of its own under the layers badge, and a rule separates one author
 * from the next. Without them the narrow bar was one undivided column of
 * squares: which pull requests were chained, and whose they were, were the two
 * things collapsing the bar threw away.
 */
function CollapsedMarks({
  current,
  state,
}: {
  current?: GitHubPullTarget;
  state: OpenPullsState;
}) {
  const groups = useMemo<CollapsedGroup[]>(() => {
    if (state.data == null) return [];
    return groupPullsByRepo(state.data.pulls, state.data.viewer).flatMap(
      (group) =>
        group.authors.map((author) => ({
          key: `${group.key}/${author.author}`,
          stacks: author.stacks.map((root) => ({
            key: `${group.key}#${String(root.pull.number)}`,
            root: root.pull,
            pulls: flattenStacks([root]).map((node) => node.pull),
          })),
        }))
    );
  }, [state.data]);

  return (
    <div className="py-1">
      {groups.map((group, groupIndex) => (
        <div
          key={group.key}
          className={cn(
            'border-line flex flex-col items-center gap-1 px-1 py-1',
            groupIndex > 0 && 'border-t'
          )}
        >
          {group.stacks.map((stack) =>
            stack.pulls.length === 1 ? (
              <CollapsedMark
                key={stack.key}
                current={current}
                pull={stack.root}
              />
            ) : (
              <div
                key={stack.key}
                className="bg-raised/50 inset-ring-line/70 flex w-full flex-col items-center gap-1 rounded-md py-1 inset-ring"
              >
                {/* The same badge the wide bar puts on this stack's caption
                    row, marked with the same key, so collapsing the bar flies
                    one badge between the two places rather than swapping it. */}
                <span
                  className="flex"
                  data-rail-flip={railStackFlipKey(stack.root)}
                >
                  <PullStackBadge size={stack.pulls.length} />
                </span>
                {stack.pulls.map((pull) => (
                  <CollapsedMark
                    key={`${pull.owner}/${pull.repo}#${String(pull.number)}`}
                    current={current}
                    pull={pull}
                  />
                ))}
              </div>
            )
          )}
        </div>
      ))}
    </div>
  );
}

/** One square in the collapsed bar. */
function CollapsedMark({
  current,
  pull,
}: {
  current?: GitHubPullTarget;
  pull: PullSummary;
}) {
  const isCurrent = isCurrentPull(pull, current);
  const label = `${pull.owner}/${pull.repo} #${String(pull.number)} — ${pull.title}`;
  return (
    <Link
      to="/$"
      params={{
        _splat: reviewTargetSplat({
          kind: 'github-pull',
          owner: pull.owner,
          repo: pull.repo,
          number: pull.number,
        }),
      }}
      aria-current={isCurrent ? 'page' : undefined}
      aria-label={label}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-md outline-none',
        'hover:bg-raised focus-visible:bg-raised',
        isCurrent && 'ring-accent bg-raised ring-2'
      )}
      title={label}
    >
      {/* The flip mark goes on this wrapper and not the link: the link also
          carries the hover tone and the current ring, which belong to their
          place in the column, while the square itself is what flies to the
          wide bar's row. A row with no status has nothing over there to pair
          with — the wide lane is empty — so its dot crossfades unmarked. */}
      <span
        className="flex items-center justify-center"
        data-rail-flip={pull.status == null ? undefined : railPullFlipKey(pull)}
      >
        {pull.status == null ? (
          <span className="bg-status-neutral size-2 rounded-full" />
        ) : (
          <PullStatusMark status={pull.status} />
        )}
      </span>
    </Link>
  );
}
