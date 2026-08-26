import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';

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

export default defineConfig({
  server: {
    port: 3000,
  },
  // Read at config time, in Node, and written into both bundles as a string.
  // Nothing at runtime can ask a Worker which commit it is.
  define: {
    'import.meta.env.VITE_COMMIT_SHA': JSON.stringify(commitSha()),
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
