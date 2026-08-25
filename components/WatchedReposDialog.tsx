'use client';

import { Dialog } from '@/components/ui/Dialog';
import { WatchedReposEditor } from '@/components/WatchedReposEditor';
import type { WatchedReposState } from '@/hooks/useWatchedRepos';

/**
 * Editing the watch list is its own task, so it gets its own window. It used to
 * replace the pull request list in place, which meant the reviewer lost sight of
 * the thing they were about to change, in a menu that closed if they clicked
 * anywhere. The header and the home page open this same dialog.
 */
export function WatchedReposDialog({
  onClose,
  open,
  watched,
}: {
  /** Called on every close, so the caller can reload what it lists. */
  onClose(): void;
  open: boolean;
  watched: WatchedReposState;
}) {
  return (
    <Dialog onClose={onClose} open={open} title="Watched repositories">
      <WatchedReposEditor watched={watched} />
    </Dialog>
  );
}
