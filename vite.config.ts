import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { z } from 'zod';

/**
 * The commit this build was made from, for the line in the home page's footer.
 *
 * Git is asked first, because it is right everywhere: `actions/checkout` leaves
 * the deploy job on the very commit it is deploying, and a developer's own
 * `pnpm dev` reports the commit they are working from. `GITHUB_SHA` is the
 * fallback for a build with no repository around it, and an empty string is the
 * honest answer when neither knows — the footer then prints nothing rather than
 * a link to a commit that may not exist.
 */
function commitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return process.env.GITHUB_SHA ?? '';
  }
}

/**
 * Which server runtime the build targets. `cloudflare` (the default) is the
 * deployed Worker; `node` is the self-hosted server, and skips the Cloudflare
 * plugin so the SSR environment builds for Node instead of workerd. A value
 * that is neither throws here, before anything is built: that is a typo, and
 * a loud failure is what tells somebody so.
 */
const target = z
  .enum(['cloudflare', 'node'])
  .default('cloudflare')
  .parse(process.env.GHDIFF_TARGET);

export default defineConfig({
  server: {
    port: 3000,
  },
  // Read at config time, in Node, and written into both bundles as a string.
  // Nothing at runtime can ask a Worker which commit it is. The target goes
  // the same way: which server runtime this build serves is answered at build
  // time, never sniffed at runtime.
  define: {
    'import.meta.env.VITE_COMMIT_SHA': JSON.stringify(commitSha()),
    'import.meta.env.VITE_GHDIFF_TARGET': JSON.stringify(target),
  },
  resolve: {
    // `@/*` comes from tsconfig.json, so the two tools cannot disagree.
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    // The server runs on workerd in development as well as in production, so a
    // Node-only API cannot pass `pnpm dev` and then fail after a deploy. The
    // self-hosted Node build swaps this for Nitro, which emits a directly
    // runnable Node server (`.output/server/index.mjs`) around the same fetch
    // handler the Worker runs. The one header rule is for the userscript: it
    // is a static asset here, and heuristic caching would hold an old script
    // for days where no-cache lets an installed one update on its own check.
    ...(target === 'node'
      ? [
          nitro({
            routeRules: {
              '/ghdiff.user.js': {
                headers: { 'cache-control': 'no-cache' },
              },
            },
          }),
        ]
      : [cloudflare({ viteEnvironment: { name: 'ssr' } })]),
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
