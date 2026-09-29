import type { LocalizationSettings } from './config.ts';
import type { LocalizationGroup } from './model.ts';

// Which languages the reviewer reads, and which they skip.
//
// The choice is one list per repository and not one per catalogue: a reviewer
// who reads Japanese reads it in every app of a monorepo. The base is always
// read, because every check is made against it and a table without it has
// nothing to compare. A generated locale is never read here, because it is the
// build's own fixture and the build already checked it.

/** The locales of a group a reviewer could choose to read. */
export function readableLocales(group: LocalizationGroup): string[] {
  const generated = new Set(group.source.generatedLocales);
  return group.locales.filter((locale) => !generated.has(locale));
}

/** Every locale on offer across a diff's catalogues, and which are bases. */
export interface LocaleChoices {
  /** The bases first, then the rest by name. */
  readable: readonly string[];
  bases: ReadonlySet<string>;
}

export function localeChoices(
  groups: readonly LocalizationGroup[]
): LocaleChoices {
  const bases = new Set<string>();
  const readable = new Set<string>();
  for (const group of groups) {
    if (group.source.baseLocale != null) bases.add(group.source.baseLocale);
    for (const locale of readableLocales(group)) readable.add(locale);
  }
  return {
    readable: [...readable].sort((a, b) => {
      const baseOrder = Number(bases.has(b)) - Number(bases.has(a));
      return baseOrder !== 0 ? baseOrder : a.localeCompare(b);
    }),
    bases,
  };
}

export function isLocaleShown(
  locale: string,
  choices: LocaleChoices,
  settings: LocalizationSettings
): boolean {
  if (choices.bases.has(locale)) return true;
  return settings.shownLocales?.includes(locale) ?? true;
}

export function shownLocales(
  group: LocalizationGroup,
  settings: LocalizationSettings
): string[] {
  const readable = readableLocales(group);
  const chosen = settings.shownLocales;
  if (chosen == null) return readable;
  const base = group.source.baseLocale;
  return readable.filter(
    (locale) => locale === base || chosen.includes(locale)
  );
}

/**
 * The settings after one press on a locale.
 *
 * A reviewer who has never chosen reads everything, so their first press turns
 * one locale off rather than every other one: the list starts from what was on
 * screen. A base is not a choice and a press on one changes nothing.
 */
export function toggleShownLocale(
  settings: LocalizationSettings,
  choices: LocaleChoices,
  locale: string
): LocalizationSettings {
  if (choices.bases.has(locale)) return settings;
  const current = settings.shownLocales ?? [...choices.readable];
  const next = current.includes(locale)
    ? current.filter((entry) => entry !== locale)
    : [...current, locale];
  return { ...settings, shownLocales: next };
}

/** Every locale on again, which is the same as never having chosen. */
export function showAllLocales(
  settings: LocalizationSettings
): LocalizationSettings {
  const next = { ...settings };
  delete next.shownLocales;
  return next;
}
