// A check box drawn rather than a native `<input type="checkbox">`: the browser
// paints one in the platform's blue, which is the single colour this app never
// uses. It is decoration inside a control that carries `aria-pressed`, so it is
// hidden from a screen reader.

/**
 * The box, in the two tones `TaskMarker` already uses for the same shape. The
 * checked state fills with the accent rather than adding a tick to the same
 * empty box: a header row is read at a glance, and a hairline tick at 13px is
 * not a glance.
 */
export function CheckBox({ checked }: { checked: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="shrink-0"
      height={13}
      viewBox="0 0 16 16"
      width={13}
    >
      <rect
        fill={checked ? 'var(--app-accent)' : 'var(--app-surface)'}
        height={13}
        rx={3.5}
        stroke={checked ? 'var(--app-accent)' : 'var(--app-ink-faint)'}
        width={13}
        x={1.5}
        y={1.5}
      />
      {checked && (
        <path
          d="M4.6 8.2 7 10.6l4.4-5"
          fill="none"
          stroke="var(--app-accent-ink)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
        />
      )}
    </svg>
  );
}
