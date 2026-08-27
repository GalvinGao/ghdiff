import { IconReload, IconSidebarLeftOpen } from '@pierre/icons';
import { useState } from 'react';

import { useAppData } from '@/components/AppDataProvider';
import { PullRequestList } from '@/components/PullRequestList';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Spinner } from '@/components/ui/Spinner';
import { WatchedReposDialog } from '@/components/WatchedReposDialog';
import { useCurrentPull } from '@/hooks/useCurrentPull';

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

  // The same test the bar itself applies: with nothing watched there is no
  // list to open, and a button onto an empty window is a promise this app
  // cannot keep. `hydrated` and not `repos.length` alone, or the button would
  // go missing for the one paint before browser storage has been read.
  if (watched.hydrated && watched.repos.length === 0) return null;

  return (
    <>
      <Button
        aria-expanded={open}
        aria-label="Open pull requests"
        className={className}
        size="icon"
        title="Open pull requests"
        variant="chrome"
        onClick={() => setOpen(true)}
      >
        <IconSidebarLeftOpen size={15} />
      </Button>

      <Dialog
        className="p-1"
        onClose={() => setOpen(false)}
        open={open}
        title="Open pull requests"
      >
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
        {/* The foot of the bar, which the list needs as much here: the watch
            list is what fills it, and a reviewer looking at an answer they did
            not expect wants the way to change it in the same window. */}
        <div className="border-line mt-1 flex items-center gap-1 border-t px-1 pt-1">
          <Button
            className="min-w-0"
            size="sm"
            variant="chrome"
            onClick={() => setEditing(true)}
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
            {pulls.loading ? (
              <Spinner label="Loading the pull requests" size={14} />
            ) : (
              <IconReload size={14} />
            )}
          </Button>
        </div>
      </Dialog>

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
