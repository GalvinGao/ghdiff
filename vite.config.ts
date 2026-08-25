import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    // `@/*` comes from tsconfig.json, so the two tools cannot disagree.
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    // The server runs on workerd in development as well as in production, so a
    // Node-only API cannot pass `pnpm dev` and then fail after a deploy.
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart(),
    // React's plugin must come after Start's.
    viteReact(),
  ],
  worker: {
    // Vite's default worker format is `iife`, which flattens every dynamic
    // import into one file: the highlight worker then loads 834 kB up front
    // instead of 211 kB plus one grammar chunk per language it meets.
    format: 'es',
  },
});
