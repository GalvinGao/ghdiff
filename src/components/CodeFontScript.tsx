import { codeFontStacks, DEFAULT_CODE_FONT } from '@/lib/codeFonts';
import { CODE_FONT_STORAGE_KEY } from '@/lib/storageKeys';

// Runs before the first paint, so the code is never drawn in one face and then
// redrawn in another. This matters more than the colour scheme it sits beside:
// the diff viewer measures the width of a character to lay out its own
// virtualized lines, and a measurement taken against the wrong face is a
// layout that has to be thrown away. It writes the same property and the same
// attribute useCodeFont maintains afterwards.
//
// The stacks are interpolated from `codeFonts.ts`, so this script and the hook
// cannot come to disagree about what a choice means.
const SCRIPT = `
(function () {
  var stacks = ${JSON.stringify(codeFontStacks())};
  try {
    var stored = localStorage.getItem('${CODE_FONT_STORAGE_KEY}');
    var font = Object.prototype.hasOwnProperty.call(stacks, stored)
      ? stored
      : '${DEFAULT_CODE_FONT}';
    document.documentElement.style.setProperty('--app-font-mono', stacks[font]);
    document.documentElement.dataset.codeFont = font;
  } catch (error) {
    document.documentElement.dataset.codeFont = '${DEFAULT_CODE_FONT}';
  }
})();
`;

export function CodeFontScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
