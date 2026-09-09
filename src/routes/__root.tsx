import {
  CatchBoundary,
  createRootRoute,
  HeadContent,
  Scripts,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { textDirection } from '../lib/locale.ts';
import { m } from '../paraglide/messages.js';
import { getLocale } from '../paraglide/runtime.js';
import { AppShell } from '@/components/AppShell';
import { CodeFontScript } from '@/components/CodeFontScript';
import { ColorModeScript } from '@/components/ColorModeScript';
import { NotFound } from '@/components/NotFound';
import { PageError } from '@/components/PageError';
import { WatchedReposScript } from '@/components/WatchedReposScript';
import { WorkerPoolProvider } from '@/components/WorkerPoolProvider';
import appCss from '@/globals.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'ghdiff' },
      {
        name: 'description',
        content: m.app_description(),
      },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      {
        rel: 'icon',
        href: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🏃‍♀️</text></svg>',
      },
    ],
  }),
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html
      lang={getLocale()}
      dir={textDirection(getLocale())}
      suppressHydrationWarning
    >
      <head>
        <HeadContent />
        <ColorModeScript />
        <CodeFontScript />
        <WatchedReposScript />
      </head>
      <body className="flex h-dvh flex-col">
        <CatchBoundary getResetKey={getLocale} errorComponent={PageError}>
          <WorkerPoolProvider>
            <AppShell>{children}</AppShell>
          </WorkerPoolProvider>
        </CatchBoundary>
        <Scripts />
      </body>
    </html>
  );
}
