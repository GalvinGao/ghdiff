import { QueryClientProvider } from '@tanstack/react-query';
import { Provider } from 'jotai';
import { type ReactNode, useState } from 'react';

import { getLocale } from '../paraglide/runtime.js';
import { AppDataProvider } from '@/components/AppDataProvider';
import { PullRail } from '@/components/PullRail';
import {
  browserQueryCaches,
  createQueryClient,
  SharedCacheContext,
} from '@/hooks/useSharedQuery';
import { textDirection } from '@/lib/locale';

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
 *
 * jotai's `Provider` is the outermost of the three, and it is here for the
 * Worker rather than for the browser. Without it every atom would resolve
 * against one store held by the module, and a Worker isolate serves many
 * requests: a value written while a page rendered would be a value the next
 * reader inherited. A `Provider` gives each render its own store, so the server
 * cannot carry a settings value from one reviewer to the next. Every reader of
 * `src/hooks/preferences.ts` sits under this.
 *
 * The query client is made per render on the server for the same reason. In
 * the browser there is one per document, with the cache every tab shares behind
 * it — see `@/lib/queryCache/sharedCache` — and the requests to GitHub go
 * through it: the shared queries, and the patch under review, which is a query
 * so the review dialog can prefetch the next one. The cache is in context and
 * never in markup, so the server's render and the first client render still
 * agree. The local command mounts no shell and makes a client of its own.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [{ client, shared }] = useState(() =>
    typeof window === 'undefined'
      ? { client: createQueryClient(), shared: null }
      : browserQueryCaches()
  );
  return (
    <Provider>
      <QueryClientProvider client={client}>
        <SharedCacheContext.Provider value={shared}>
          <AppDataProvider>
            {/* `data-sheet-host` is what steps back behind an open sheet, and
              `bg-canvas` is what it steps back with: the document turns black
              behind it then, and a transparent shell would let that through. */}
            <div
              dir="ltr"
              className="bg-canvas flex min-h-0 flex-1"
              data-sheet-host=""
            >
              <PullRail />
              <div
                dir={textDirection(getLocale())}
                className="flex min-h-0 min-w-0 flex-1 flex-col"
              >
                {children}
              </div>
            </div>
          </AppDataProvider>
        </SharedCacheContext.Provider>
      </QueryClientProvider>
    </Provider>
  );
}
