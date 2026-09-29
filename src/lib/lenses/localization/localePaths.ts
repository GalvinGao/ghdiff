// Which files of a diff are one message catalogue in several languages.
//
// A source is a path with one `{locale}` in it, and a file belongs to it when
// the rest of the path matches letter for letter. That is deliberately all a
// pattern can say: a glob would let one source claim files the reviewer never
// meant, and the files it claims leave the diff for the panel.

/** Locale names that are not languages but a build's own fixtures. */
const GENERATED_LOCALE_NAMES = new Set([
  'key',
  'keys',
  'pseudo',
  'qps-ploc',
  'en-xa',
  'ar-xb',
  'zz',
]);

export function isGeneratedLocaleName(locale: string): boolean {
  return GENERATED_LOCALE_NAMES.has(locale.toLowerCase());
}

// A language subtag, then any number of region, script or variant subtags, in
// either separator. Loose on purpose: `pt_BR`, `zh-Hant` and `en-US` are all
// names a repository uses for a file.
const LOCALE_CODE = /^[a-z]{2,3}(?:[-_](?:[a-z]{2}|[a-z]{4}|\d{3}))*$/i;

export function isLocaleName(value: string): boolean {
  return LOCALE_CODE.test(value) || isGeneratedLocaleName(value);
}

export const LOCALE_TOKEN = '{locale}';

/** The locale a path names under one pattern, or nothing. */
export function matchLocalePath(
  path: string,
  pattern: string
): string | undefined {
  const at = pattern.indexOf(LOCALE_TOKEN);
  if (at < 0) return undefined;
  const prefix = pattern.slice(0, at);
  const suffix = pattern.slice(at + LOCALE_TOKEN.length);
  if (!path.startsWith(prefix) || !path.endsWith(suffix)) return undefined;
  if (path.length < prefix.length + suffix.length + 1) return undefined;
  const locale = path.slice(prefix.length, path.length - suffix.length);
  return locale.includes('/') ? undefined : locale;
}

/** Three is where a directory of names stops being a coincidence. */
const MIN_DETECTED_LOCALES = 3;

/** The extensions a lens can parse today, so detection offers nothing else. */
const DETECTABLE_EXTENSIONS = ['.json'];

export interface DetectedPattern {
  pattern: string;
  locales: string[];
}

/**
 * The catalogues a list of changed paths holds, read off the paths alone.
 *
 * Every path is tried with each of its segments as the locale — the file's own
 * stem, as in `messages/en.json`, or a directory, as in `locales/en/app.json`.
 * A pattern is kept when three or more distinct locales answer to it. A path
 * that two patterns both claim goes to the one with more locales, which is the
 * reading that explains more of the diff.
 */
export function detectLocalePatterns(
  paths: readonly string[]
): DetectedPattern[] {
  const byPattern = new Map<string, Set<string>>();
  for (const path of paths) {
    if (!DETECTABLE_EXTENSIONS.some((extension) => path.endsWith(extension))) {
      continue;
    }
    for (const candidate of candidatePatterns(path)) {
      const locales = byPattern.get(candidate.pattern) ?? new Set<string>();
      locales.add(candidate.locale);
      byPattern.set(candidate.pattern, locales);
    }
  }

  const kept = [...byPattern]
    .filter(([, locales]) => locales.size >= MIN_DETECTED_LOCALES)
    .map(([pattern, locales]) => ({ pattern, locales: [...locales].sort() }))
    .sort(
      (a, b) =>
        b.locales.length - a.locales.length ||
        a.pattern.localeCompare(b.pattern)
    );

  const claimed = new Set<string>();
  const result: DetectedPattern[] = [];
  for (const detected of kept) {
    const own = paths.filter(
      (path) =>
        !claimed.has(path) && matchLocalePath(path, detected.pattern) != null
    );
    const locales = new Set(
      own.map((path) => matchLocalePath(path, detected.pattern) ?? '')
    );
    if (locales.size < MIN_DETECTED_LOCALES) continue;
    for (const path of own) claimed.add(path);
    result.push({ pattern: detected.pattern, locales: [...locales].sort() });
  }
  return result.sort((a, b) => a.pattern.localeCompare(b.pattern));
}

function candidatePatterns(
  path: string
): { pattern: string; locale: string }[] {
  const segments = path.split('/');
  const candidates: { pattern: string; locale: string }[] = [];
  for (const [index, segment] of segments.entries()) {
    const last = index === segments.length - 1;
    const dot = last ? segment.indexOf('.') : -1;
    const value = dot > 0 ? segment.slice(0, dot) : segment;
    if (!isLocaleName(value)) continue;
    const replaced = [...segments];
    replaced[index] = LOCALE_TOKEN + (dot > 0 ? segment.slice(dot) : '');
    candidates.push({ pattern: replaced.join('/'), locale: value });
  }
  return candidates;
}

/** The folder a pattern lives in, for the panel's heading. */
export function patternLabel(pattern: string): string {
  const at = pattern.indexOf(LOCALE_TOKEN);
  const head = pattern.slice(0, at).replace(/\/$/, '');
  return head.length > 0 ? head : pattern;
}
