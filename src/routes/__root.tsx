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
          'Open any GitHub pull request, commit, or compare range by swapping github.com for ghdiff.com. Narrow the file list with preset path rules, and post line comments back to GitHub.',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
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
