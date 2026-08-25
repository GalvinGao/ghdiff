import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { ColorModeScript } from '@/components/ColorModeScript';
import { NotFound } from '@/components/NotFound';
import { WorkerPoolProvider } from '@/components/WorkerPoolProvider';
import appCss from '@/globals.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'reviewer' },
      {
        name: 'description',
        content:
          'Review a GitHub pull request, commit, or compare range, with preset file filters and comments that sync to GitHub.',
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
      </head>
      <body className="flex h-dvh flex-col">
        <WorkerPoolProvider>{children}</WorkerPoolProvider>
        <Scripts />
      </body>
    </html>
  );
}
