// Keep the CLI compiler and Vite on the same locale strategy. Review URLs must
// remain GitHub paths, so language selection never adds a URL prefix.
/** @type {import('@inlang/paraglide-js').CompilerOptions} */
export const i18nConfig = {
  project: './project.inlang',
  outdir: './src/paraglide',
  strategy: ['cookie', 'baseLocale'],
  // CLI checks and a running dev server share this directory. Vite's implicit
  // development layout differs from the CLI default, so pin one layout.
  outputStructure: 'message-modules',
  emitTsDeclarations: true,
};
