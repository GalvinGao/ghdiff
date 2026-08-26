/// <reference types="vite/client" />

// What the build writes into both bundles. `vite/client` types every `VITE_`
// key as `any`, and this app reads one of them, so it is named here instead.

interface ImportMetaEnv {
  /**
   * The commit this build was made from, in full, or an empty string when the
   * build had no repository to ask. `vite.config.ts` reads it from git.
   */
  readonly VITE_COMMIT_SHA: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
