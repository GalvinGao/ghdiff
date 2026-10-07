import type { CodeViewOptions } from '@pierre/diffs';
import { useMemo } from 'react';

import { type ColorValue, findColorValues } from '@/lib/colorValues';

/** The viewer installs this inside each file's shadow root. */
export const COLOR_PREVIEWS_CSS = `
[data-ghdiff-color], [data-ghdiff-color-chip] {
  background: repeating-conic-gradient(#fff 0% 25%, #ccc 0% 50%) 0 / 6px 6px;
  border: 1px solid color-mix(in srgb, var(--diffs-fg) 35%, transparent);
  border-radius: 2px;
  position: relative;
}
[data-ghdiff-color] {
  appearance: none;
  display: inline-block;
  width: 12px;
  height: 12px;
  padding: 0;
  margin: 0 4px 0 2px;
  vertical-align: -1px;
  cursor: help;
  user-select: none;
}
[data-ghdiff-color]::after, [data-ghdiff-color-chip]::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--ghdiff-preview-color);
  border-radius: 1px;
}
[data-ghdiff-color]:focus-visible {
  outline: 2px solid var(--diffs-fg);
  outline-offset: 2px;
}
[data-ghdiff-color-info] {
  position: fixed;
  inset: auto;
  margin: 0;
  padding: 12px;
  width: max-content;
  min-width: min(300px, calc(100vw - 16px));
  max-width: calc(100vw - 16px);
  border: 1px solid var(--app-line, #888);
  border-radius: 8px;
  background: var(--app-raised, var(--diffs-bg));
  color: var(--app-ink, var(--diffs-fg));
  box-shadow: 0 4px 16px #0002;
  font-family: var(--diffs-header-font-family, system-ui);
  font-size: 12px;
  line-height: 1.5;
  white-space: normal;
  overflow-wrap: anywhere;
  pointer-events: none;
}
[data-ghdiff-color-info]::backdrop { background: transparent; }
[data-ghdiff-color-heading] { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
[data-ghdiff-color-source] { margin: 0; flex: 1; font-weight: 600; }
[data-ghdiff-color-chip] { width: 32px; height: 32px; flex-shrink: 0; }
[data-ghdiff-color-details] { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3px 12px; margin: 0; }
[data-ghdiff-color-details] dt { color: var(--app-ink-muted, var(--diffs-fg)); }
[data-ghdiff-color-details] dd { margin: 0; font-family: var(--diffs-font-family, monospace); }
`;

interface ColorPreviewController {
  show(button: HTMLButtonElement, color: ColorValue): void;
  hide(): void;
  activeButton(): HTMLButtonElement | undefined;
  dispose(): void;
}

const controllers = new WeakMap<HTMLElement, ColorPreviewController>();
let nextTooltipId = 0;
let hideActiveTooltip: (() => void) | undefined;

function createController(
  container: HTMLElement,
  root: ShadowRoot
): ColorPreviewController {
  const doc = container.ownerDocument;
  const tooltip = doc.createElement('div');
  tooltip.dataset.ghdiffColorInfo = '';
  tooltip.id = `ghdiff-color-info-${++nextTooltipId}`;
  tooltip.popover = 'manual';
  tooltip.setAttribute('role', 'tooltip');
  const events = new AbortController();
  let active: HTMLButtonElement | undefined;

  const hide = () => {
    active?.removeAttribute('aria-describedby');
    active = undefined;
    if (tooltip.matches(':popover-open')) tooltip.hidePopover();
    if (hideActiveTooltip === hide) hideActiveTooltip = undefined;
  };
  // Scrolling can recycle a virtualized row or move it without another render.
  doc.addEventListener('scroll', hide, {
    capture: true,
    signal: events.signal,
  });
  root.addEventListener('scroll', hide, {
    capture: true,
    signal: events.signal,
  });
  doc.defaultView?.addEventListener('resize', hide, { signal: events.signal });
  doc.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') hide();
    },
    { signal: events.signal }
  );
  doc.addEventListener(
    'pointerdown',
    (event) => {
      if (active != null && !event.composedPath().includes(active)) hide();
    },
    { signal: events.signal }
  );

  return {
    show(button, color) {
      hideActiveTooltip?.();
      hide();
      hideActiveTooltip = hide;
      active = button;
      tooltip.replaceChildren();
      const chip = doc.createElement('div');
      chip.dataset.ghdiffColorChip = '';
      chip.style.setProperty('--ghdiff-preview-color', color.rgb);
      chip.setAttribute('aria-hidden', 'true');
      const source = doc.createElement('p');
      source.dataset.ghdiffColorSource = '';
      source.textContent = color.source;
      const heading = doc.createElement('div');
      heading.dataset.ghdiffColorHeading = '';
      heading.appendChild(source);
      heading.appendChild(chip);
      const details = doc.createElement('dl');
      details.dataset.ghdiffColorDetails = '';
      for (const [label, value] of [
        ['HEX', color.hex],
        ['RGB', color.rgb],
        ['HSL', color.hsl],
        ['α', color.opacity],
      ]) {
        const term = doc.createElement('dt');
        term.textContent = label;
        const description = doc.createElement('dd');
        description.textContent = value;
        details.appendChild(term);
        details.appendChild(description);
      }
      tooltip.appendChild(heading);
      tooltip.appendChild(details);
      if (tooltip.parentNode !== root) root.appendChild(tooltip);
      button.setAttribute('aria-describedby', tooltip.id);
      tooltip.showPopover();

      const anchor = button.getBoundingClientRect();
      const box = tooltip.getBoundingClientRect();
      const viewport = doc.documentElement;
      const left = Math.max(
        8,
        Math.min(anchor.left, viewport.clientWidth - box.width - 8)
      );
      const top =
        anchor.bottom + 6 + box.height <= viewport.clientHeight - 8
          ? anchor.bottom + 6
          : Math.max(8, anchor.top - box.height - 6);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    },
    hide,
    activeButton: () => active,
    dispose() {
      hide();
      events.abort();
      tooltip.remove();
    },
  };
}

function makeSwatch(
  doc: Document,
  color: ColorValue,
  controller: ColorPreviewController | undefined
): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.dataset.ghdiffColor = color.source;
  button.style.setProperty('--ghdiff-preview-color', color.rgb);
  button.setAttribute('aria-label', color.source);
  button.addEventListener('pointerdown', (event) => event.stopPropagation());
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    controller?.show(button, color);
  });
  if (controller == null) {
    button.title = `${color.source}\nHEX: ${color.hex}\nRGB: ${color.rgb}\nHSL: ${color.hsl}\nα: ${color.opacity}`;
    button.setAttribute('aria-label', button.title);
    return button;
  }
  button.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'touch') controller.show(button, color);
  });
  button.addEventListener('pointerleave', () => {
    const root = button.getRootNode();
    if (root instanceof ShadowRoot && root.activeElement !== button) {
      controller.hide();
    }
  });
  button.addEventListener('focus', () => controller.show(button, color));
  button.addEventListener('blur', () => controller.hide());
  return button;
}

/** Decorates only the rows this render produced, including expanded context. */
export function applyColorPreviews(container: HTMLElement): void {
  const root = container.shadowRoot;
  if (root == null) return;
  let controller = controllers.get(container);
  const active = controller?.activeButton();
  if (active != null && !root.contains(active)) controller?.hide();

  for (const row of root.querySelectorAll<HTMLElement>(
    '[data-content] > [data-line]'
  )) {
    // A selection-only pass can reuse the same rows. Empty buttons have no text,
    // so copying a line still returns exactly what the author wrote.
    if (row.querySelector('[data-ghdiff-color]') != null) continue;
    const colors = findColorValues(row.textContent ?? '');
    if (colors.length === 0) continue;
    if (
      controller == null &&
      typeof HTMLElement.prototype.showPopover === 'function'
    ) {
      controller = createController(container, root);
      controllers.set(container, controller);
    }
    const doc = row.ownerDocument;
    const walker = doc.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    const insertions: { node: Text; offset: number; color: ColorValue }[] = [];
    let offset = 0;
    let colorIndex = 0;
    let node: Node | null;
    while ((node = walker.nextNode()) != null && colorIndex < colors.length) {
      const text = node as Text;
      const end = offset + text.length;
      while (colorIndex < colors.length && colors[colorIndex].start < end) {
        insertions.push({
          node: text,
          offset: colors[colorIndex].start - offset,
          color: colors[colorIndex],
        });
        colorIndex++;
      }
      offset = end;
    }
    // Work backwards so multiple colors in one text node keep their offsets.
    for (const insertion of insertions.reverse()) {
      const tail = insertion.node.splitText(insertion.offset);
      tail.parentNode?.insertBefore(
        makeSwatch(doc, insertion.color, controller),
        tail
      );
    }
  }
}

export function disposeColorPreviews(container: HTMLElement): void {
  controllers.get(container)?.dispose();
  controllers.delete(container);
}

/** Adds previews before other decorators compute ranges over the source text. */
export function useColorPreviews<Metadata>(
  options: CodeViewOptions<Metadata>
): CodeViewOptions<Metadata> {
  return useMemo(
    () => ({
      ...options,
      unsafeCSS: (options.unsafeCSS ?? '') + COLOR_PREVIEWS_CSS,
      onPostRender(...args) {
        const [node, , phase] = args;
        if (node != null) {
          if (phase === 'unmount') disposeColorPreviews(node);
          else applyColorPreviews(node);
        }
        // Preserve every argument, including the item context newer viewers add.
        if (options.onPostRender != null) {
          Reflect.apply(options.onPostRender, undefined, args);
        }
      },
    }),
    [options]
  );
}
