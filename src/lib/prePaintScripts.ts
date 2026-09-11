import { codeFontStacks, DEFAULT_CODE_FONT } from './codeFonts.ts';
import {
  CODE_FONT_STORAGE_KEY,
  COLOR_MODE_STORAGE_KEY,
} from './storageKeys.ts';

// The two settings that have to be on the document element before anything is
// drawn, as source text rather than as components.
//
// They live here because two hosts serve this app and neither one can write the
// other's document. The Worker renders them through React, in the head
// `__root.tsx` describes. The `ghdiff` command serves a plain HTML file and
// inlines these same strings into it. One statement of each, so the two first
// paints cannot come to disagree about what a stored value means.
//
// Nothing here touches a browser API at module scope, because both callers are
// servers. Each is a constant rather than a function: what they interpolate is
// constant too.

/**
 * Settles the colour scheme before the first paint, so the chrome never flashes
 * the wrong one. It writes the same two attributes `useColorMode` maintains
 * afterwards.
 */
export const COLOR_MODE_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${COLOR_MODE_STORAGE_KEY}');
    var mode = stored === 'light' || stored === 'dark' ? stored : 'system';
    var scheme =
      mode === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : mode;
    document.documentElement.dataset.colorScheme = scheme;
    document.documentElement.dataset.colorMode = mode;
  } catch (error) {
    document.documentElement.dataset.colorScheme = 'light';
  }
})();
`;

/**
 * Settles the code font before the first paint. This matters more than the
 * colour scheme beside it: the diff viewer measures the width of a character to
 * lay out its own virtualized lines, and a measurement taken against the wrong
 * face is a layout that has to be thrown away.
 *
 * The stacks are interpolated from `codeFonts.ts`, so this script and
 * `useCodeFont` cannot come to disagree about what a choice means.
 */
export const CODE_FONT_SCRIPT = `
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
