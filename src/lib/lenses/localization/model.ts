import type { LocaleSource } from './config.ts';
import {
  type CatalogueChange,
  type CatalogueSource,
  readFlatCatalogue,
} from './flatJson.ts';
import { matchLocalePath, patternLabel } from './localePaths.ts';
import { placeholderNames } from './placeholders.ts';

// A catalogue's changes, turned around: by key first and by locale second.
//
// The diff draws one file per locale, so the same three keys arrive eighteen
// times and the reviewer compares them by scrolling. The model is the table the
// reviewer was building in their head — each key once, with every locale's old
// and new text beside it — plus the questions the table can answer by itself.

export type LocalizationKeyKind = 'added' | 'removed' | 'changed';

export interface LocaleValue {
  itemId: string;
  old?: string;
  new?: string;
  oldLine?: number;
  newLine?: number;
}

export type LocalizationIssueKind =
  | 'missing-placeholder'
  | 'extra-placeholder'
  | 'absent'
  | 'same-as-base';

export interface LocalizationIssue {
  locale: string;
  kind: LocalizationIssueKind;
  /** The placeholder names in question, for the two placeholder kinds. */
  names?: string[];
}

export interface LocalizationKey {
  key: string;
  kind: LocalizationKeyKind;
  values: ReadonlyMap<string, LocaleValue>;
  issues: readonly LocalizationIssue[];
}

export interface LocalizationGroup {
  source: LocaleSource;
  /** The folder the catalogue sits in. */
  label: string;
  /** Every locale this diff touches, the base first and then by name. */
  locales: readonly string[];
  keys: readonly LocalizationKey[];
  /** The files this group claimed, in `locales` order. */
  itemIds: readonly string[];
  /** Files the pattern matched and the reader refused, which stay in the diff. */
  unreadPaths: readonly string[];
}

export interface LocalizationModel {
  groups: readonly LocalizationGroup[];
  /** The files the panel shows, and so the files the diff does not. */
  claimedItemIds: ReadonlySet<string>;
}

export const EMPTY_LOCALIZATION_MODEL: LocalizationModel = {
  groups: [],
  claimedItemIds: new Set(),
};

export interface CatalogueFile {
  itemId: string;
  path: string;
  fileDiff: CatalogueSource;
}

/**
 * Only an issue is a problem. A translation equal to the base is often right —
 * a product name, `OK`, a number format — so it is shown as a note and never
 * counted against the catalogue.
 */
export function isProblem(issue: LocalizationIssue): boolean {
  return issue.kind !== 'same-as-base';
}

export function buildLocalizationModel(
  files: readonly CatalogueFile[],
  sources: readonly LocaleSource[]
): LocalizationModel {
  const claimedItemIds = new Set<string>();
  const groups: LocalizationGroup[] = [];

  for (const source of sources) {
    const read: {
      locale: string;
      itemId: string;
      changes: CatalogueChange[];
    }[] = [];
    const unreadPaths: string[] = [];
    for (const file of files) {
      if (claimedItemIds.has(file.itemId)) continue;
      const locale = matchLocalePath(file.path, source.pattern);
      if (locale == null) continue;
      const changes = readFlatCatalogue(file.fileDiff);
      if (changes == null) {
        unreadPaths.push(file.path);
        continue;
      }
      read.push({ locale, itemId: file.itemId, changes });
    }
    if (read.length === 0) continue;
    for (const file of read) claimedItemIds.add(file.itemId);

    const locales = orderLocales(
      read.map((file) => file.locale),
      source.baseLocale
    );
    const order = new Map(locales.map((locale, index) => [locale, index]));
    read.sort(
      (a, b) => (order.get(a.locale) ?? 0) - (order.get(b.locale) ?? 0)
    );

    // Keys in the order the first file lists them, which is the base's order
    // when the base is in the diff: the order a reader of the base file meets
    // them in.
    const byKey = new Map<string, Map<string, LocaleValue>>();
    for (const file of read) {
      const ordered = [...file.changes].sort(
        (a, b) => lineOf(a) - lineOf(b) || a.key.localeCompare(b.key)
      );
      for (const change of ordered) {
        const values = byKey.get(change.key) ?? new Map<string, LocaleValue>();
        values.set(file.locale, { itemId: file.itemId, ...change });
        byKey.set(change.key, values);
      }
    }

    const keys: LocalizationKey[] = [];
    for (const [key, values] of byKey) {
      const kind = keyKind(values, source.baseLocale);
      keys.push({
        key,
        kind,
        values,
        issues: checkKey(kind, values, locales, source),
      });
    }

    groups.push({
      source,
      label: patternLabel(source.pattern),
      locales,
      keys,
      itemIds: read.map((file) => file.itemId),
      unreadPaths,
    });
  }

  return { groups, claimedItemIds };
}

function lineOf(change: { newLine?: number; oldLine?: number }): number {
  return change.newLine ?? change.oldLine ?? 0;
}

function orderLocales(
  locales: readonly string[],
  base: string | undefined
): string[] {
  return [...new Set(locales)].sort((a, b) => {
    if (a === base) return -1;
    if (b === base) return 1;
    return a.localeCompare(b);
  });
}

function valueKind(value: LocaleValue): LocalizationKeyKind {
  if (value.old == null) return 'added';
  if (value.new == null) return 'removed';
  return 'changed';
}

/** The base's own kind, or the one every locale agrees on, or `changed`. */
function keyKind(
  values: ReadonlyMap<string, LocaleValue>,
  base: string | undefined
): LocalizationKeyKind {
  const baseValue = base == null ? undefined : values.get(base);
  if (baseValue != null) return valueKind(baseValue);
  const kinds = new Set([...values.values()].map(valueKind));
  const [only] = kinds;
  return kinds.size === 1 && only != null ? only : 'changed';
}

/**
 * What the table can say about one key without reading any language.
 *
 * Every check is against the base, and only against the locales this diff
 * touches: a catalogue the pull request left alone is not in the patch, so
 * there is nothing here to say it lacks the key. Generated locales are the
 * build's own fixtures and are never checked.
 */
function checkKey(
  kind: LocalizationKeyKind,
  values: ReadonlyMap<string, LocaleValue>,
  locales: readonly string[],
  source: LocaleSource
): LocalizationIssue[] {
  const base = source.baseLocale;
  if (base == null || kind === 'removed') return [];
  const baseText = values.get(base)?.new;
  if (baseText == null) return [];
  const baseNames = placeholderNames(baseText, source.placeholders);
  const generated = new Set(source.generatedLocales);

  const issues: LocalizationIssue[] = [];
  for (const locale of locales) {
    if (locale === base || generated.has(locale)) continue;
    const text = values.get(locale)?.new;
    if (text == null) {
      if (kind === 'added') issues.push({ locale, kind: 'absent' });
      continue;
    }
    const names = placeholderNames(text, source.placeholders);
    const missing = multisetDifference(baseNames, names);
    const extra = multisetDifference(names, baseNames);
    if (missing.length > 0) {
      issues.push({ locale, kind: 'missing-placeholder', names: missing });
    }
    if (extra.length > 0) {
      issues.push({ locale, kind: 'extra-placeholder', names: extra });
    }
    if (text === baseText && /\p{L}/u.test(text)) {
      issues.push({ locale, kind: 'same-as-base' });
    }
  }
  return issues;
}

function multisetDifference(
  from: readonly string[],
  remove: readonly string[]
): string[] {
  const left = [...remove];
  const result: string[] = [];
  for (const name of from) {
    const at = left.indexOf(name);
    if (at >= 0) left.splice(at, 1);
    else result.push(name);
  }
  return result;
}
