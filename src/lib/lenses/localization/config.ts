import {
  detectLocalePatterns,
  isGeneratedLocaleName,
  LOCALE_TOKEN,
} from './localePaths.ts';
import { isPlaceholderSyntax, type PlaceholderSyntax } from './placeholders.ts';

// What a reviewer tells the localization lens about one repository.
//
// Two kinds of fact live here, and they have different owners even though both
// are kept in this browser. Where the catalogues are and how their messages
// are written are facts about the repository, and detection can usually answer
// them from the diff itself. Which languages are worth reading is the
// reviewer's own choice. The shape keeps them apart, so either can move
// somewhere else later without the other.

/** The one message format the lens can read today. */
export type CatalogueFormat = 'flat-json';

/** One catalogue: a path per locale, and how its messages are written. */
export interface LocaleSource {
  /** A repository path with one `{locale}` in it. */
  pattern: string;
  format: CatalogueFormat;
  placeholders: PlaceholderSyntax;
  /** The locale every other one is checked against. None means no checks. */
  baseLocale?: string;
  /** Locales a build writes for itself, which are hidden and never checked. */
  generatedLocales: string[];
}

export interface LocalizationSettings {
  enabled: boolean;
  /** Absent while the sources are read off each diff as it arrives. */
  sources?: LocaleSource[];
  /** Absent until the reviewer picks, which reads as every real language. */
  shownLocales?: string[];
}

export const DEFAULT_LOCALIZATION_SETTINGS: LocalizationSettings = {
  enabled: true,
};

const DEFAULT_BASE_LOCALES = ['en', 'en-US', 'en_US', 'en-GB'];

/** The sources a diff's own paths suggest, with the defaults filled in. */
export function detectLocaleSources(paths: readonly string[]): LocaleSource[] {
  return detectLocalePatterns(paths).map(({ pattern, locales }) => ({
    pattern,
    format: 'flat-json',
    placeholders: 'braces',
    baseLocale: DEFAULT_BASE_LOCALES.find((locale) => locales.includes(locale)),
    generatedLocales: locales.filter(isGeneratedLocaleName),
  }));
}

/** The sources in force for one diff: the reviewer's, or detected ones. */
export function resolveLocaleSources(
  settings: LocalizationSettings,
  paths: readonly string[]
): LocaleSource[] {
  if (!settings.enabled) return [];
  return settings.sources ?? detectLocaleSources(paths);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  );
}

function acceptSource(value: unknown): LocaleSource | undefined {
  if (typeof value !== 'object' || value == null) return undefined;
  const record = value as Record<string, unknown>;
  const { pattern, format, placeholders, baseLocale, generatedLocales } =
    record;
  if (typeof pattern !== 'string' || !pattern.includes(LOCALE_TOKEN)) {
    return undefined;
  }
  if (format !== 'flat-json' || !isPlaceholderSyntax(placeholders)) {
    return undefined;
  }
  if (baseLocale != null && typeof baseLocale !== 'string') return undefined;
  if (!isStringArray(generatedLocales)) return undefined;
  return {
    pattern,
    format,
    placeholders,
    ...(baseLocale == null || baseLocale === '' ? {} : { baseLocale }),
    generatedLocales,
  };
}

/**
 * Reads a stored value back, or refuses it. A source that does not parse is
 * dropped rather than failing the whole setting, the way one bad row of the
 * watch list costs that row alone.
 */
export function acceptLocalizationSettings(
  value: unknown
): LocalizationSettings | undefined {
  if (typeof value !== 'object' || value == null) return undefined;
  const { enabled, sources, shownLocales } = value as Record<string, unknown>;
  if (typeof enabled !== 'boolean') return undefined;
  const settings: LocalizationSettings = { enabled };
  if (Array.isArray(sources)) {
    settings.sources = sources
      .map(acceptSource)
      .filter((source) => source != null);
  }
  if (isStringArray(shownLocales)) settings.shownLocales = shownLocales;
  return settings;
}
