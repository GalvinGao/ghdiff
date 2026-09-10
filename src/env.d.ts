/// <reference types="vite/client" />

// What the build writes into both bundles. `vite/client` types every `VITE_`
// key as `any`, and this app reads two of them, so they are named here instead.

interface ImportMetaEnv {
  /**
   * The commit this build was made from, in full, or an empty string when the
   * build had no repository to ask. `vite.config.ts` reads it from git.
   */
  readonly VITE_COMMIT_SHA: string;
  /**
   * Which server runtime this build serves, written by `vite.config.ts` from
   * the same `GHDIFF_TARGET` the build itself reads.
   */
  readonly VITE_GHDIFF_TARGET: 'cloudflare' | 'node';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
