// The test workspace: node-environment projects for the unit tests in src/lib
// and for the `ghdiff` command's own logic, and two for the live e2e suites
// against the fixture repositories.
// Vitest reads this file instead of vite.config.ts, so the app's
// Cloudflare/TanStack plugins never load for tests.
import { defineConfig } from 'vitest/config';

const e2e = {
  // The fixtures are shared, live repositories — files serialize.
  fileParallelism: false,
  testTimeout: 60_000,
  // The hooks reset the fixtures: every marked artifact read in full, page by
  // page, then deleted one call at a time, against a live forge.
  hookTimeout: 120_000,
} as const;

export default defineConfig({
  define: {
    // Tests run the Node half of every build-time branch — the in-memory
    // served backend, the TTY log shape — so the target is named here, the
    // same way the build names it for a bundle.
    'import.meta.env.VITE_GHDIFF_TARGET': JSON.stringify('node'),
  },
  resolve: {
    // `@/*` and `@test/*` come from tsconfig.json — vite.config.ts reads them
    // the same way, so the three tools cannot disagree.
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
      {
        test: {
          name: 'gitlab',
          environment: 'node',
          include: ['test/e2e/gitlab/*.test.ts'],
          // One setup per forge: a single-forge run never touches the other
          // forge's fixture.
          globalSetup: './test/e2e/gitlab/setup.ts',
          ...e2e,
        },
      },
      {
        test: {
          name: 'github',
          environment: 'node',
          include: ['test/e2e/github/*.test.ts'],
          globalSetup: './test/e2e/github/setup.ts',
          ...e2e,
        },
      },
    ],
  },
});
