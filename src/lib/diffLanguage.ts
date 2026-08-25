import type { SupportedLanguages } from '@pierre/diffs';

// @pierre/diffs picks a language from the path it is handed, and its table is
// keyed by extension: `getFiletypeFromFileName` takes the text after the last
// dot. A file whose name IS its type has no such text, so `docker/Dockerfile`
// resolves to plain text, and a suffixed one such as `.env.local` resolves on
// `local`. Only a root `Dockerfile` and a bare `.env` come out right.
//
// So ghdiff answers for the two families it meets most and sets the answer on
// the diff item as `lang`, which the renderer prefers over its own guess. The
// grammars are already in the highlighter's bundle; nothing here registers one.

/** The language for a path, or undefined to leave the guess to the library. */
export function diffLanguage(path: string): SupportedLanguages | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();

  // `Dockerfile`, `Dockerfile.dev`, `web.dockerfile`.
  if (
    name === 'dockerfile' ||
    name.startsWith('dockerfile.') ||
    name.endsWith('.dockerfile')
  ) {
    return 'dockerfile';
  }

  // `.env`, `.env.local`, `.env.example`, `production.env`. `.envrc` is direnv,
  // which is shell, so the prefix test carries the dot that ends the name.
  if (name === '.env' || name.startsWith('.env.') || name.endsWith('.env')) {
    return 'dotenv';
  }

  return undefined;
}
