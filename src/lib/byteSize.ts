import { m } from '../paraglide/messages.js';
import { formatNumber } from './locale.ts';
// How much has arrived, in words a reviewer reads at a glance.
//
// Decimal and not binary — kB and MB, a thousand each — because that is what a
// browser's own download shelf says and what a diff is quoted in. One decimal
// place at MB scale and none below it: the figure is there to show movement, and
// a second decimal moves too fast to read.

const KB = 1000;
const MB = 1000 * KB;

/** Bytes as a short label. Never a percentage: nothing states the total. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return m.bytes_count({ count: 0 });
  if (bytes < KB) return m.bytes_count({ count: Math.round(bytes) });
  if (bytes < MB)
    return m.bytes_kilobytes({ value: formatNumber(Math.round(bytes / KB)) });
  return m.bytes_megabytes({
    value: formatNumber(bytes / MB, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }),
  });
}
