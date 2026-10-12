// The test workspace: node-environment projects for the unit tests in src/lib
// and for the `ghdiff` command's own logic. Vitest reads this file instead of
// vite.config.ts, so the app's Cloudflare/TanStack plugins never load for
// tests.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // `@/*` comes from tsconfig.json — vite.config.ts reads it the same way,
    // so the tools cannot disagree.
    tsconfigPaths: true,
  },
  test: {
    projects: [
      {
        test: {
          name: 'lib',
          environment: 'node',
          include: ['src/lib/**/*.test.ts'],
        },
      },
      {
        // The `ghdiff` command's own logic: its arguments, its git ranges and
        // its request guards. Pure like the lib suites, and run beside them.
        test: {
          name: 'cli',
          environment: 'node',
          include: ['cli/src/**/*.test.ts'],
        },
      },
    ],
  },
});
