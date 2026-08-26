// The "Served" figure in the home page's footer. The store's half of it lives
// in `@/lib/server/servedCount`, which is a Workers module and cannot be
// imported here: this file is read by the browser and by the test runner.

/**
 * The count a stored value stands for. Everything the store can answer with
 * that is not a count reads as zero — a key nothing has written yet, a body
 * that is not a number, a negative — because the footer draws nothing for zero
 * and no figure at all is better than a wrong one.
 */
export function parseServedCount(raw: string | null): number {
  if (raw == null) return 0;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/** The figure as the footer prints it, grouped in thousands. */
export function formatServedCount(count: number): string {
  return count.toLocaleString('en-US');
}
