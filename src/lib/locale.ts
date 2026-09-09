import { getLocale } from '../paraglide/runtime.js';

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(getLocale(), options).format(value);
}

export function formatList(values: string[]): string {
  return new Intl.ListFormat(getLocale(), { type: 'conjunction' }).format(
    values
  );
}

export function textDirection(locale: string): 'rtl' | 'ltr' {
  return ['ar', 'fa', 'he', 'ur'].includes(locale.split('-')[0])
    ? 'rtl'
    : 'ltr';
}
