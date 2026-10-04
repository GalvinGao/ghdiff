import { IconReload } from '@pierre/icons';
import { useState } from 'react';

import { m } from '../paraglide/messages.js';
import { useAppData } from '@/components/AppDataProvider';
import { PullRequestList } from '@/components/PullRequestList';
import {
  PullListGlyph,
  pullScopeLabel,
  PullScopeSwitch,
} from '@/components/PullScopeSwitch';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Spinner } from '@/components/ui/Spinner';
import { WatchedReposDialog } from '@/components/WatchedReposDialog';
import { useCurrentPull } from '@/hooks/useCurrentPull';
import { useHydrated } from '@/hooks/useHydrated';
import { usePullScope } from '@/hooks/usePullScope';

// What the left bar is on a phone.
//
// The bar is a column beside the diff on every wider screen, and a column is
// what a phone has least of: 272px of the 402 an iPhone gives left 130 for the
// review itself. So below `--breakpoint-phone` the bar's own element is not
// drawn at all and this is what stands in for it — the same list, the same
// rows, behind the leftmost control on the screen.
//
// It asks `useAppData()` itself rather than being handed the list. The bar
// does the same, and the provider mounts one copy of that state above both, so
// the two cannot come to disagree about which pull requests are open.
//
// The button carries no `max-phone:` of its own: it is drawn where it is used,
// and both callers are the ones that decide a phone gets it.

export function PullListButton({ className }: { className?: string }) {
  const { pulls, watched } = useAppData();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const current = useCurrentPull();
  // Asked here as well as in the switch, because a toolbar row with nothing in
  // it would still take its height out of the sheet, and because the sheet is
  // titled by the tab that is chosen. While the list is on its way both come
  // from the guess the skeleton draws, so neither changes when the answer
  // lands unless the guess was wrong.
  const scope = usePullScope(pulls, current);
  const tabs = scope.waiting?.tabs ?? scope.tabs;
  const chosen = scope.waiting?.scope ?? scope.scope;
  // The sheet is mounted only past hydration. This button is in the review
  // route, which hydrates after the bar has already read the stored scope, so
  // a sheet rendered on that pass titled itself with the stored tab where the
  // server had the fallback, and React rebuilt the route over it. The sheet is
  // closed on the server and on the first paint alike, so waiting costs
  // nothing anybody sees.
  const hydrated = useHydrated();

  // The same test the bar itself applies: with nothing watched there is no
  // list to open, and a button onto an empty window is a promise this app
  // cannot keep. `hydrated` and not `repos.length` alone, or the button would
  // go missing for the one paint before browser storage has been read.
  if (watched.hydrated && watched.repos.length === 0) return null;

  return (
    <>
      <Button
        aria-expanded={open}
        aria-label={m.pull_list_button_open_pull_requests()}
        className={className}
        size="icon"
        title={m.pull_list_button_open_pull_requests()}
        variant="chrome"
        onClick={() => setOpen(true)}
      >
        {/* What the sheet holds rather than where it comes from. A sidebar
            glyph named the bar, and a phone has no bar: the window is the pull
            requests and the stacks they make. */}
        <PullListGlyph />
      </Button>

      {/* A sheet, because this is the left bar brought up from below: a list
          to pick from on a screen held in one hand, where the bottom edge is
          where the thumb already is and a swipe down is how it goes away. */}
      {hydrated && (
        <Dialog
          className="p-1"
          onClose={() => setOpen(false)}
          open={open}
          presentation="sheet"
          // The sheet is the list the chosen tab draws, so it says which one:
          // a title that read "Open pull requests" over Mine alone named a list
          // that was not on screen.
          title={pullScopeLabel(chosen)}
          // Under the title rather than over the list, because the bar is the
          // part of this sheet that does not scroll away, and the repository
          // headings in the list pin under whatever height the bar has.
          toolbar={
            tabs.length > 1 ? (
              <PullScopeSwitch current={current} size="touch" state={pulls} />
            ) : undefined
          }
        >
          {/* The bar's own toolbar, which the list needs as much here: the
              watch list is what fills it, and a reviewer looking at an answer
              they did not expect wants the way to change it in the same window.
              Above the list, as in the bar. */}
          <div className="border-line mb-1 flex items-center gap-1 border-b px-1 pb-1">
            <Button
              className="min-w-0"
              size="sm"
              variant="chrome"
              onClick={() => setEditing(true)}
            >
              <span className="truncate">
                {m.pull_list_button_watched_repos()}
              </span>
            </Button>
            <Button
              aria-label={m.pull_list_button_reload_the_pull_requests()}
              className="ml-auto"
              disabled={pulls.loading}
              size="icon-sm"
              title={m.pull_list_button_reload_the_pull_requests()}
              variant="chrome"
              onClick={pulls.reload}
            >
              {pulls.loading ? (
                <Spinner
                  label={m.pull_list_button_loading_the_pull_requests()}
                  size={14}
                />
              ) : (
                <IconReload size={14} />
              )}
            </Button>
          </div>
          <PullRequestList
            current={current}
            hydrated={watched.hydrated}
            repos={watched.repos}
            state={pulls}
            // A row taps through to a review, and the window it was tapped in
            // has to go with it: the dialog sits in the top layer, above the
            // diff the reviewer just asked for.
            onNavigate={() => setOpen(false)}
          />
        </Dialog>
      )}

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
