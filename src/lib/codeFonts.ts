// The faces the diff can be read in.
//
// A code review is almost entirely code, so this is the one typeface choice
// worth offering: the diff's own lines, the paths in the tree and the comment
// list, and every sha on screen are set in it. The chrome's sans is not a
// choice, and the diff's file headers follow it rather than this.
//
// Each stack lives here and nowhere else. `globals.css` states the platform's
// own mono as `--app-font-mono-system` and every stack below ends in that
// property, so a face that fails to download still leaves a monospace behind
// it and the system stack is written once. A choice is applied by setting
// `--app-font-mono` on the document element, which is the same element `:root`
// matches, so the inline value wins over the stylesheet's default.
//
// This module is read by the pre-paint script as it builds its own source text,
// so it must stay free of any browser-only import.

export type CodeFontId = 'system' | 'jetbrains' | 'geist' | 'fira';

export interface CodeFont {
  id: CodeFontId;
  /** What the menu calls it. */
  label: string;
  /** The whole `font-family` list, tail included. */
  stack: string;
}

/** The tail of every stack, and the whole of the system one. */
const SYSTEM = 'var(--app-font-mono-system)';

/**
 * The order the menu draws, which is the platform's own face and then three
 * that have to be fetched.
 *
 * Each of the three is a fontsource **variable** package: one file covers the
 * whole weight range, and the diff asks for more than one — shiki paints a
 * keyword bold where a theme says so, and the chrome sets a medium on a path.
 * A static package would cost a download per weight. Only the upright range is
 * imported: the one italic scope either theme carries is `markup.italic`,
 * emphasis inside a markdown file, and the browser's own slant covers that for
 * less than a second face costs.
 */
export const CODE_FONTS: readonly CodeFont[] = [
  { id: 'system', label: 'System', stack: SYSTEM },
  {
    id: 'jetbrains',
    label: 'JetBrains Mono',
    stack: `'JetBrains Mono Variable', ${SYSTEM}`,
  },
  {
    id: 'geist',
    label: 'Geist Mono',
    stack: `'Geist Mono Variable', ${SYSTEM}`,
  },
  { id: 'fira', label: 'Fira Code', stack: `'Fira Code Variable', ${SYSTEM}` },
];

export const DEFAULT_CODE_FONT: CodeFontId = 'system';

export function isCodeFont(value: string | null): value is CodeFontId {
  return CODE_FONTS.some((font) => font.id === value);
}

/** The stack for a choice, and the system one for anything unrecognized. */
export function codeFontStack(id: string | null): string {
  return CODE_FONTS.find((font) => font.id === id)?.stack ?? SYSTEM;
}

/** `{ id: stack }`, which is what the pre-paint script carries inline. */
export function codeFontStacks(): Record<string, string> {
  return Object.fromEntries(CODE_FONTS.map((font) => [font.id, font.stack]));
}
