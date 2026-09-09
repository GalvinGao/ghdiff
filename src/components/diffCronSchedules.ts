import type { FileDiffMetadata } from '@pierre/diffs';

import { findCronSchedules } from '@/lib/cron';

// Generated content leaves the code's text nodes, copy and line anchors alone.
// Absolute positioning keeps the virtualizer's measured line heights intact,
// even with wrapping enabled. A narrow pane clips the hint, never the code;
// the row's native tooltip carries the complete reading and its timezone caveat.
export const CRON_SCHEDULES_CSS = `
[data-ghdiff-cron] {
  position: relative;
  overflow: clip;
}
[data-ghdiff-cron]::after {
  content: attr(data-ghdiff-cron);
  position: absolute;
  padding-inline-start: 1.5em;
  color: var(--app-ink-muted);
  font-family: var(--app-font-sans);
  font-size: 11px;
  white-space: pre;
  pointer-events: none;
  user-select: none;
}
`;

// Cache rendered rows, not whole patches. A huge diff pays only for its visible
// window; a new highlighter pass or hydration changes the text and invalidates it.
const renderedRows = new WeakMap<HTMLElement, { text: string; path: string }>();

export function applyCronSchedules(
  container: HTMLElement,
  fileDiff: FileDiffMetadata | undefined
): void {
  if (container.shadowRoot == null || fileDiff == null) return;
  for (const row of container.shadowRoot.querySelectorAll<HTMLElement>(
    '[data-line]'
  )) {
    const path =
      row.dataset.lineType === 'change-deletion'
        ? (fileDiff.prevName ?? fileDiff.name)
        : fileDiff.name;
    const text = row.textContent ?? '';
    const cached = renderedRows.get(row);
    if (cached?.text === text && cached.path === path) continue;
    renderedRows.set(row, { text, path });
    const schedules = findCronSchedules(text, path);
    if (schedules.length === 0) {
      if (row.hasAttribute('data-ghdiff-cron')) {
        row.removeAttribute('data-ghdiff-cron');
        row.removeAttribute('title');
      }
      continue;
    }
    row.dataset.ghdiffCron = schedules
      .map(({ description }) => description)
      .join(' · ');
    row.title = `${schedules.map(({ expression, description }) => `${expression} — ${description}`).join('\n')}\nTimes use the scheduler’s timezone, not your browser’s.`;
  }
}
