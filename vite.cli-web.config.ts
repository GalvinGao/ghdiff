import tailwindcss from '@tailwindcss/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The client the `ghdiff` command serves.
//
// A plain single-page build, and deliberately not the Worker's one. `pnpm
// build` produces a document the Worker renders — TanStack Start's server entry
// writes the head, the router payload and the hydration markup — and there is
// no server here to render it. So this build has its own `index.html` and its
// own entry, and everything below `ReviewScreen` is the same code the hosted
// app runs.
//
// None of this reaches the Worker. It is a separate `vite build` with a
// separate output, so the roughly 74 KiB of gzipped headroom the deployment
// guards is untouched by anything in `cli/`.
export default defineConfig({
  root: 'cli/web',
  // Served from the root of a loopback origin that holds nothing else.
  base: '/',
  resolve: {
    // `@/*` comes from tsconfig.json, the same way the Worker's build reads it.
    tsconfigPaths: true,
  },
  plugins: [tailwindcss(), viteReact()],
  build: {
    outDir: '../../dist/cli/web',
    emptyOutDir: true,
    // No sourcemaps. This bundle is downloaded by `npx` before the command can
    // run at all, and the entry's map alone is 7.4 MB against the 1.9 MB of
    // code it describes — a wait, every time, for a file nobody reading a diff
    // opens. The command's own bundle keeps its map: it is 80 KB, and a stack
    // trace in the terminal is the one that gets read.
    sourcemap: false,
  },
  worker: {
    // The same reason as the Worker's build: Vite's default `iife` flattens
    // every grammar into the highlight worker's entry, so it would load 834 kB
    // up front instead of 211 kB and one chunk per language it meets.
    format: 'es',
  },
});
