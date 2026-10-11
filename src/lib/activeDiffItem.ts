/** File tops grow in patch order, including equal tops for empty items. */
export interface ItemTopReader {
  getTopForItem(id: string): number | undefined;
}

/** The last file whose top has passed the sticky-header anchor. */
export function activeDiffItemAt(
  itemIds: readonly string[],
  anchor: number,
  viewer: ItemTopReader
): string | undefined {
  let low = 0;
  let high = itemIds.length - 1;
  let found: string | undefined;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const id = itemIds[middle];
    const top = viewer.getTopForItem(id);
    if (top == null) {
      // The controlled items and viewer can briefly disagree during an
      // update. Preserve the previous skip-missing behavior in that case.
      found = undefined;
      for (const candidate of itemIds) {
        const candidateTop = viewer.getTopForItem(candidate);
        if (candidateTop == null) continue;
        if (candidateTop > anchor) break;
        found = candidate;
      }
      return found;
    }
    if (top <= anchor) {
      found = id;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
