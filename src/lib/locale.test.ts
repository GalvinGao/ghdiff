import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getLocale, overwriteGetLocale } from '../paraglide/runtime.js';
import { formatList, formatNumber } from './locale.ts';

test('formatters follow locale changes and keep option combinations separate', () => {
  const original = getLocale;
  try {
    for (const locale of ['en', 'de', 'ja', 'ar', 'en'] as const) {
      overwriteGetLocale(() => locale);
      for (const options of [
        undefined,
        { minimumFractionDigits: 1 },
        { maximumFractionDigits: 0 },
      ]) {
        assert.equal(
          formatNumber(1234.56, options),
          new Intl.NumberFormat(locale, options).format(1234.56)
        );
      }
      assert.equal(
        formatList(['one', 'two', 'three']),
        new Intl.ListFormat(locale, { type: 'conjunction' }).format([
          'one',
          'two',
          'three',
        ])
      );
    }
  } finally {
    overwriteGetLocale(original);
  }
});

test('changing an options object does not reuse its previous format', () => {
  const options = { minimumFractionDigits: 1 };
  const locale = getLocale();
  assert.equal(
    formatNumber(2, options),
    new Intl.NumberFormat(locale, options).format(2)
  );
  options.minimumFractionDigits = 3;
  assert.equal(
    formatNumber(2, options),
    new Intl.NumberFormat(locale, options).format(2)
  );
});
