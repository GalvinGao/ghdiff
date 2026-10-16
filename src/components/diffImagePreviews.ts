import { m } from '../paraglide/messages.js';
import { findImageLinks } from '@/lib/imageLinks';

export const IMAGE_PREVIEWS_CSS = `
[data-ghdiff-image] {
  appearance: none; display: inline-block; position: relative;
  width: 16px; height: 16px; padding: 0; margin: 0 4px 0 2px;
  border: 0; border-radius: 3px; background: transparent;
  color: var(--diffs-fg); vertical-align: -3px; cursor: pointer; user-select: none;
}
[data-ghdiff-image] svg { display: block; width: 14px; height: 14px; }
[data-ghdiff-image]:hover { background: color-mix(in srgb, var(--diffs-fg) 12%, transparent); }
[data-ghdiff-image]:focus-visible { outline: 2px solid var(--diffs-fg); outline-offset: 2px; }
[data-ghdiff-image-preview] {
  position: fixed; inset: auto; z-index: 1000; margin: 0; padding: 10px;
  box-sizing: border-box; width: min(360px, calc(100vw - 16px));
  border: 1px solid var(--app-line, #888); border-radius: 8px;
  background: var(--app-raised, var(--diffs-bg)); color: var(--app-ink, var(--diffs-fg));
  box-shadow: 0 6px 24px #0003; font: 12px/1.5 system-ui; white-space: normal;
}
[data-ghdiff-image-preview]::backdrop { background: transparent; }
[data-ghdiff-image-preview][hidden] { display: none; }
[data-ghdiff-image-header] { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
[data-ghdiff-image-header] a { min-width: 0; flex: 1; color: inherit; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: ltr; }
[data-ghdiff-image-close] { flex: none; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; }
[data-ghdiff-image-close]:hover { background: var(--app-surface, var(--diffs-bg)); }
[data-ghdiff-image-frame] {
  display: grid; place-items: center; height: min(220px, 40dvh); overflow: hidden;
  border-radius: 4px; background: repeating-conic-gradient(#ffffff 0% 25%, #e5e5e5 0% 50%) 0 / 16px 16px;
}
[data-ghdiff-image-frame] img { width: 100%; height: 100%; min-height: 0; object-fit: contain; }
[data-ghdiff-image-status] { padding: 16px; color: #333; text-align: center; }
`;

interface PreviewController {
  show(button: HTMLButtonElement, url: string, focus?: boolean): void;
  leave(): void;
  activeButton(): HTMLButtonElement | undefined;
  hide(restoreFocus?: boolean): void;
  dispose(): void;
}

const controllers = new WeakMap<HTMLElement, PreviewController>();
let closeActive: (() => void) | undefined;
let nextId = 0;

function createController(
  container: HTMLElement,
  root: ShadowRoot
): PreviewController {
  const doc = container.ownerDocument;
  const win = doc.defaultView!;
  const panel = doc.createElement('div');
  panel.dataset.ghdiffImagePreview = '';
  panel.id = `ghdiff-image-preview-${++nextId}`;
  panel.setAttribute('role', 'dialog');
  const nativePopover =
    'popover' in panel && typeof panel.showPopover === 'function';
  // Legacy fallback escapes the CodeView's clipped/contained file shadow root.
  const fallbackHost = nativePopover ? undefined : doc.createElement('div');
  const panelRoot = fallbackHost?.attachShadow({ mode: 'open' }) ?? root;
  if (fallbackHost != null) {
    const style = doc.createElement('style');
    style.textContent = IMAGE_PREVIEWS_CSS;
    panelRoot.appendChild(style);
    doc.body.appendChild(fallbackHost);
  }
  if (nativePopover) panel.popover = 'manual';
  else panel.hidden = true;
  const events = new AbortController();
  let active: HTMLButtonElement | undefined;
  let image: HTMLImageElement | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  let overPanel = false;
  let suppressFocus = false;

  const hide = (restoreFocus = false) => {
    clearTimeout(closeTimer);
    clearTimeout(loadTimer);
    const previous = active;
    active?.setAttribute('aria-expanded', 'false');
    active?.removeAttribute('aria-controls');
    active = undefined;
    if (image != null) {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
      image = undefined;
    }
    if (nativePopover && panel.matches(':popover-open')) panel.hidePopover();
    else panel.hidden = true;
    panel.replaceChildren();
    overPanel = false;
    if (closeActive === hide) closeActive = undefined;
    if (restoreFocus && previous?.isConnected) {
      suppressFocus = true;
      previous.focus({ preventScroll: true });
      suppressFocus = false;
    }
  };
  const leave = () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (
        !overPanel &&
        root.activeElement !== active &&
        !panel.contains(panelRoot.activeElement)
      )
        hide();
    }, 180);
  };
  panel.addEventListener('pointerenter', () => {
    overPanel = true;
    clearTimeout(closeTimer);
  });
  panel.addEventListener('pointerleave', () => {
    overPanel = false;
    leave();
  });
  panel.addEventListener('focusout', leave);
  const hideOnMove = () => hide();
  doc.addEventListener('scroll', hideOnMove, {
    capture: true,
    signal: events.signal,
  });
  root.addEventListener('scroll', hideOnMove, {
    capture: true,
    signal: events.signal,
  });
  win.addEventListener('resize', hideOnMove, { signal: events.signal });
  doc.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && active != null) {
        event.preventDefault();
        hide(true);
      }
    },
    { signal: events.signal }
  );
  doc.addEventListener(
    'pointerdown',
    (event) => {
      if (
        active != null &&
        !event.composedPath().includes(active) &&
        !event.composedPath().includes(panel)
      )
        hide();
    },
    { signal: events.signal }
  );
  // A popover lives outside the code rows; its presses never select a code line.
  panel.addEventListener('pointerdown', (event) => event.stopPropagation());
  panel.addEventListener('click', (event) => event.stopPropagation());

  return {
    show(button, url, focus = false) {
      if (suppressFocus) return;
      clearTimeout(closeTimer);
      if (active === button) {
        if (focus) panel.querySelector('a')?.focus();
        return;
      }
      closeActive?.();
      hide();
      closeActive = hide;
      active = button;
      panel.setAttribute('aria-label', m.image_preview_label({ url }));
      const header = doc.createElement('div');
      header.dataset.ghdiffImageHeader = '';
      const link = doc.createElement('a');
      link.href = url;
      link.textContent = url;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      const close = doc.createElement('button');
      close.type = 'button';
      close.dataset.ghdiffImageClose = '';
      close.setAttribute('aria-label', m.dialog_close());
      close.textContent = '×';
      close.addEventListener('click', () => hide(true));
      header.appendChild(link);
      header.appendChild(close);
      const frame = doc.createElement('div');
      frame.dataset.ghdiffImageFrame = '';
      const status = doc.createElement('div');
      status.dataset.ghdiffImageStatus = '';
      status.setAttribute('role', 'status');
      status.textContent = m.image_preview_loading();
      frame.appendChild(status);
      panel.appendChild(header);
      panel.appendChild(frame);
      panelRoot.appendChild(panel);
      button.setAttribute('aria-expanded', 'true');
      button.setAttribute('aria-controls', panel.id);
      if (nativePopover) {
        panel.hidden = false;
        panel.showPopover();
      } else panel.hidden = false;
      const anchor = button.getBoundingClientRect();
      const box = panel.getBoundingClientRect();
      panel.style.left = `${Math.max(8, Math.min(anchor.left, doc.documentElement.clientWidth - box.width - 8))}px`;
      panel.style.top = `${anchor.bottom + 6 + box.height <= doc.documentElement.clientHeight - 8 ? anchor.bottom + 6 : Math.max(8, anchor.top - box.height - 6)}px`;
      const pending = doc.createElement('img');
      image = pending;
      pending.alt = url;
      pending.referrerPolicy = 'no-referrer';
      pending.decoding = 'async';
      const fail = () => {
        if (image !== pending) return;
        clearTimeout(loadTimer);
        status.textContent = m.image_preview_failed();
        pending.onerror = null;
        pending.onload = null;
        pending.removeAttribute('src');
      };
      pending.onload = () => {
        if (image !== pending) return;
        clearTimeout(loadTimer);
        frame.replaceChildren(pending);
      };
      pending.onerror = fail;
      loadTimer = setTimeout(fail, 15_000);
      pending.src = url;
      if (focus) link.focus();
    },
    leave,
    activeButton: () => active,
    hide,
    dispose() {
      hide();
      events.abort();
      panel.remove();
      fallbackHost?.remove();
    },
  };
}

function makeButton(
  doc: Document,
  url: string,
  controller: PreviewController
): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.dataset.ghdiffImage = url;
  button.setAttribute('aria-label', m.image_preview_label({ url }));
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  // Empty SVG keeps copied text and search/highlight column offsets unchanged.
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor"/><circle cx="5" cy="6" r="1.5" fill="currentColor"/><path d="m3 12 4-4 2 2 2-3 3 5" fill="none" stroke="currentColor"/>';
  button.appendChild(svg);
  button.addEventListener('pointerdown', (event) => event.stopPropagation());
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    controller.show(button, url, event.detail === 0);
  });
  button.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'touch') controller.show(button, url);
  });
  button.addEventListener('pointerleave', () => controller.leave());
  button.addEventListener('focus', () => controller.show(button, url));
  button.addEventListener('blur', () => controller.leave());
  return button;
}

/** Runs only over virtualized, rendered rows, including expanded context. */
export function applyImagePreviews(container: HTMLElement): void {
  const root = container.shadowRoot;
  if (root == null) return;
  let controller = controllers.get(container);
  const active = controller?.activeButton();
  if (active != null && !root.contains(active)) controller?.hide();
  for (const row of root.querySelectorAll<HTMLElement>(
    '[data-content] > [data-line]'
  )) {
    if (row.querySelector('[data-ghdiff-image]') != null) continue;
    const links = findImageLinks(row.textContent ?? '');
    if (links.length === 0) continue;
    if (controller == null) {
      controller = createController(container, root);
      controllers.set(container, controller);
    }
    const doc = row.ownerDocument;
    const walker = doc.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    const insertions: { node: Text; offset: number; url: string }[] = [];
    let offset = 0;
    let index = 0;
    for (
      let node = walker.nextNode();
      node != null && index < links.length;
      node = walker.nextNode()
    ) {
      const text = node as Text;
      const end = offset + text.length;
      while (index < links.length && links[index].start < end) {
        insertions.push({
          node: text,
          offset: links[index].start - offset,
          url: links[index].url,
        });
        index++;
      }
      offset = end;
    }
    for (const insertion of insertions.reverse()) {
      const tail = insertion.node.splitText(insertion.offset);
      tail.parentNode?.insertBefore(
        makeButton(doc, insertion.url, controller),
        tail
      );
    }
  }
}

export function disposeImagePreviews(container: HTMLElement): void {
  controllers.get(container)?.dispose();
  controllers.delete(container);
}
