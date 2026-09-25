/** The built-in hunk controls live inside the viewer's shadow roots. */
export const EXPANSION_LOADING_CSS = `
[data-expand-button][aria-busy='true'] {
  position: relative;
  cursor: progress;
}

[data-expand-button][aria-busy='true'] > [data-icon] {
  visibility: hidden;
}

[data-expand-button][aria-busy='true']:not([data-expand-all-button])::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 13px;
  height: 13px;
  box-sizing: border-box;
  border: 1.5px solid color-mix(in srgb, currentColor 25%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: ghdiff-expansion-spin 1.2s linear infinite;
}

@keyframes ghdiff-expansion-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  [data-expand-button][aria-busy='true']:not([data-expand-all-button])::after {
    animation: none;
  }
}
`;

export function applyExpansionLoading(
  container: HTMLElement,
  loading: boolean
): void {
  const buttons = container.shadowRoot?.querySelectorAll<HTMLElement>(
    '[data-expand-button]'
  );
  for (const button of buttons ?? []) {
    if (loading) {
      button.setAttribute('aria-busy', 'true');
      button.setAttribute('aria-label', 'Loading unmodified lines');
    } else if (button.hasAttribute('aria-busy')) {
      button.removeAttribute('aria-busy');
      button.removeAttribute('aria-label');
    }
  }
}
