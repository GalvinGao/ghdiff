import { CODE_FONT_SCRIPT } from '@/lib/prePaintScripts';

// Runs before the first paint, so the code is never drawn in one face and then
// redrawn in another. This matters more than the colour scheme it sits beside:
// the diff viewer measures the width of a character to lay out its own
// virtualized lines, and a measurement taken against the wrong face is a layout
// that has to be thrown away.
//
// The source text is `src/lib/prePaintScripts.ts`, which the `ghdiff` command's
// own server inlines into the document it serves.

export function CodeFontScript() {
  return <script dangerouslySetInnerHTML={{ __html: CODE_FONT_SCRIPT }} />;
}
