import type { ReactNode } from 'react';

import { AppDataProvider } from '@/components/AppDataProvider';
import { PullRail } from '@/components/PullRail';

/**
 * The frame every page sits in: the pull request bar on the left, the page to
 * the right of it. The bar is part of the app rather than part of a screen, so
 * moving between pull requests never unmounts it and never re-asks GitHub for
 * the list.
 *
 * On a phone the bar is hidden and each screen carries a `PullListButton`
 * instead, which opens the same list in a window. The bar stays mounted behind
 * that, so it is still holding the width and the scroll it was left at when the
 * window widens.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AppDataProvider>
      <div className="flex min-h-0 flex-1">
        <PullRail />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </AppDataProvider>
  );
}
