import { useEffect } from 'react';

import { codeFontPreference, usePreference } from './preferences';
import { type CodeFontId, codeFontStack } from '@/lib/codeFonts';

export interface CodeFontState {
  font: CodeFontId;
  setFont(font: CodeFontId): void;
  /** True once the stored choice has been read on the client. */
  hydrated: boolean;
}

/**
 * Owns the face the code is read in. `CodeFontScript` already applied the
 * stored choice before paint; this hook takes over the same property and the
 * same attribute, and follows a choice made in another tab.
 *
 * The property is set on every applied choice, System included, so the document
 * element always states the face rather than leaving it to be read off two
 * places at once.
 */
export function useCodeFont(): CodeFontState {
  const {
    value: font,
    hydrated,
    setValue: setFont,
  } = usePreference(codeFontPreference);

  useEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;
    root.style.setProperty('--app-font-mono', codeFontStack(font));
    root.dataset.codeFont = font;
  }, [font, hydrated]);

  return { font, hydrated, setFont };
}
