import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/AppShell';
import { ColorModeScript } from '@/components/ColorModeScript';
import { NotFound } from '@/components/NotFound';
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
        content:
          'Open any GitHub pull request, commit, or compare range by swapping github.com for ghdiff.com. Narrow the file list with preset path rules, and write line comments that land back on GitHub.',
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <ColorModeScript />
        <WatchedReposScript />
      </head>
      <body className="flex h-dvh flex-col">
        <WorkerPoolProvider>
          <AppShell>{children}</AppShell>
        </WorkerPoolProvider>
        <Scripts />
      </body>
    </html>
  );
}
