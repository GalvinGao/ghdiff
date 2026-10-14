import { getLocale } from '../paraglide/runtime.js';

// Download progress and tree statistics format thousands of values. Intl
// constructors are much more expensive than formatting with an existing one.
// Include the current locale in each key, also for concurrent SSR requests.
// A bounded cache avoids retaining arbitrary option combinations forever.
const FORMATTER_LIMIT = 32;
const numberFormats = new Map<string, Intl.NumberFormat>();
const listFormats = new Map<string, Intl.ListFormat>();

function remember<T>(cache: Map<string, T>, key: string, value: T): T {
  if (cache.size >= FORMATTER_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions
): string {
  const locale = getLocale();
  const key = JSON.stringify([locale, options]);
  const formatter =
    numberFormats.get(key) ??
    remember(numberFormats, key, new Intl.NumberFormat(locale, options));
  return formatter.format(value);
}

export function formatList(values: string[]): string {
  const locale = getLocale();
  const formatter =
    listFormats.get(locale) ??
    remember(
      listFormats,
      locale,
      new Intl.ListFormat(locale, { type: 'conjunction' })
    );
  return formatter.format(values);
}

export function textDirection(locale: string): 'rtl' | 'ltr' {
  return ['ar', 'fa', 'he', 'ur'].includes(locale.split('-')[0])
    ? 'rtl'
    : 'ltr';
}
