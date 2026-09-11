import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { defineConfig, type Plugin } from 'vite';

// The `ghdiff` command itself: one file, no runtime dependencies.
//
// A bundle rather than a directory of compiled modules, for two reasons that
// are both about the person installing it. `npx ghdiff` fetches and runs a
// package with nothing to resolve, and an install cannot be broken by a
// transitive dependency it never asked for — this command spawns `git` and
// serves files, and it has no business carrying a dependency tree to do it.
//
// The only things it imports out of `src/` are pure: the target model, the two
// pre-paint scripts, and the file-size cap. None of them reaches for a browser
// API or for `@pierre/diffs`, so the bundle stays a few dozen kilobytes.

const manifest = JSON.parse(
  await readFile(new URL('./cli/package.json', import.meta.url), 'utf8')
) as { version: string };

/**
 * Puts the package's own manifest and its README beside the two build outputs,
 * so `dist/cli` is a directory `npm install -g` and `npm pack` both accept as
 * it stands.
 */
function packageManifest(): Plugin {
  return {
    name: 'ghdiff-cli-manifest',
    async closeBundle() {
      await mkdir(new URL('./dist/cli/', import.meta.url), { recursive: true });
      for (const file of ['package.json', 'README.md']) {
        await copyFile(
          new URL(`./cli/${file}`, import.meta.url),
          new URL(`./dist/cli/${file}`, import.meta.url)
        );
      }
      // npm refuses to publish or pack a directory holding a lockfile it did
      // not write, and there is nothing here to lock.
      await writeFile(
        new URL('./dist/cli/.npmrc', import.meta.url),
        'package-lock=false\n'
      );
    },
  };
}

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  define: {
    // Read at build time, because a bundled file cannot find the package.json
    // it came from once it is installed somewhere else.
    __GHDIFF_VERSION__: JSON.stringify(manifest.version),
  },
  // Vite externalizes a dependency in an SSR build by default, which would
  // leave `import { Hono } from 'hono'` in a file `npx` runs with nothing
  // beside it. Everything goes in, which is what makes the output one file and
  // an install unbreakable by a transitive dependency it never asked for.
  ssr: { noExternal: true },
  // `public/` belongs to the Worker's build: it holds the userscript, which
  // Cloudflare serves as an asset. Nothing in it is the command's.
  publicDir: false,
  plugins: [packageManifest()],
  build: {
    ssr: 'cli/src/main.ts',
    outDir: 'dist/cli/bin',
    emptyOutDir: true,
    // Node, and a recent one: `engines` in the manifest says the same figure.
    target: 'node20',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      output: {
        format: 'esm',
        entryFileNames: 'ghdiff.js',
        // What makes the file executable as a command rather than importable
        // as a module.
        banner: '#!/usr/bin/env node',
      },
    },
  },
});
