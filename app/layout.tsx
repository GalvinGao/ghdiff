import type { Metadata, Viewport } from 'next';

import { ColorModeScript } from '@/components/ColorModeScript';
import { WorkerPoolProvider } from '@/components/WorkerPoolProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'reviewer',
  description:
    'Review a GitHub pull request or a local git range, with preset file filters and comments that sync to GitHub.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ColorModeScript />
      </head>
      <body className="flex h-dvh flex-col">
        <WorkerPoolProvider>{children}</WorkerPoolProvider>
      </body>
    </html>
  );
}
