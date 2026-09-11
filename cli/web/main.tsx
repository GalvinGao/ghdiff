import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { Provider } from 'jotai';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { LocalAppData } from './LocalAppData';
import { claimToken, installTokenHeader } from './localFetch';
import { ReviewScreen } from '@/components/ReviewScreen';
// The whole stylesheet, as a side effect, which is what a stylesheet is in a
// bundled page. `__root.tsx` imports the same file `?url` instead, because a
// server-rendered document needs a `<link>` to name.
// oxlint-disable-next-line import/no-unassigned-import
import '@/globals.css';
import { CenteredNotice } from '@/components/ui/CenteredNotice';
import { WorkerPoolProvider } from '@/components/WorkerPoolProvider';
import type { LocalDiffTarget } from '@/lib/reviewTarget';

// The ghdiff review surface, mounted against a diff on this machine.
//
// This is the whole of what the `ghdiff` command's client is: the same
// `ReviewScreen` the hosted app renders, under the same worker pool and the
// same jotai store, over a target whose diff comes from `git` instead of from
// GitHub. Nothing below this file knows the difference, because there is none
// to know — a patch is a patch.
//
// What is different is what is *not* here. There is no `AppShell`, so no left
// bar and no watch list; no `AppDataProvider`, so no session and no request to
// GitHub at all; no `/setup`, no account menu, no served counter. The capability
// handshake this once seemed to need turned out to be a host that simply does
// not draw what it cannot serve.

declare global {
  interface Window {
    /**
     * The repository, the range, and the files git is not tracking, written
     * into the document by the server. The last of those is the one fact this
     * page cannot read off the patch: an untracked file's diff says `new file`
     * like any other, and only the host that listed the working tree knows
     * which of them git has never been told about.
     */
    __GHDIFF_LOCAL__?: string;
  }
}

interface Bootstrap {
  target?: LocalDiffTarget;
  untracked?: readonly string[];
}

function readBootstrap(): Bootstrap {
  const raw = window.__GHDIFF_LOCAL__;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw) as Bootstrap;
    return {
      target: parsed.target?.kind === 'local-diff' ? parsed.target : undefined,
      untracked: Array.isArray(parsed.untracked) ? parsed.untracked : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * The one thing this page can be wrong about, and the one sentence that fixes
 * it. A document with no bootstrap or no token was opened from somewhere other
 * than the address the command printed — usually a bookmark from a run that has
 * since been stopped.
 */
function Stopped({ reason }: { reason: string }) {
  return (
    <CenteredNotice role="alert">
      <h1 className="text-ink text-sm font-medium">ghdiff is not running</h1>
      <p className="text-ink-muted mt-1 text-sm text-pretty">{reason}</p>
    </CenteredNotice>
  );
}

const { target, untracked } = readBootstrap();
const token = claimToken();
if (token != null) installTokenHeader(token);

const rootRoute = createRootRoute({
  component: () => (
    <WorkerPoolProvider>
      <Provider>
        <LocalAppData>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Outlet />
          </div>
        </LocalAppData>
      </Provider>
    </WorkerPoolProvider>
  ),
});

function LocalReview() {
  if (target == null) {
    return (
      <Stopped reason="This page did not come from a ghdiff command. Run ghdiff in a repository and open the address it prints." />
    );
  }
  if (token == null) {
    return (
      <Stopped reason="This tab has no key for the server. Open the address the ghdiff command printed." />
    );
  }
  return <ReviewScreen target={target} untrackedPaths={untracked} />;
}

// One route, at the root, and a catch-all beside it. The diff is the whole
// application here, so every address is the same screen — which also means the
// `ghdiff` link in the header and a stray path both land somewhere real.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LocalReview,
});

const splatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$',
  component: LocalReview,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, splatRoute]),
  // Nothing here is preloaded and nothing is scrolled by the router: the diff
  // is its own scroll region and `useDiffAnchor` owns the fragment.
  scrollRestoration: false,
});

const container = document.getElementById('root');
if (container != null) {
  createRoot(container).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
}
