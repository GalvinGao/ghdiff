import { useCallback, useEffect, useState } from 'react';

import { readStoredString, writeStoredString } from './useLocalStorage';
import {
  type CodeFontId,
  codeFontStack,
  DEFAULT_CODE_FONT,
  isCodeFont,
} from '@/lib/codeFonts';
import { CODE_FONT_STORAGE_KEY } from '@/lib/storageKeys';

export interface CodeFontState {
  font: CodeFontId;
  setFont(font: CodeFontId): void;
  /** True once the stored choice has been read on the client. */
  hydrated: boolean;
}

/**
 * Owns the face the code is read in. `CodeFontScript` already applied the
 * stored choice before paint; this hook takes over the same property and the
 * same attribute.
 *
 * The property is set on every applied choice, System included, so the document
 * element always states the face rather than leaving it to be read off two
 * places at once.
 */
export function useCodeFont(): CodeFontState {
  const [font, setFontState] = useState<CodeFontId>(DEFAULT_CODE_FONT);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = readStoredString(CODE_FONT_STORAGE_KEY);
    if (isCodeFont(stored)) setFontState(stored);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;
    root.style.setProperty('--app-font-mono', codeFontStack(font));
    root.dataset.codeFont = font;
  }, [font, hydrated]);

  const setFont = useCallback((next: CodeFontId) => {
    setFontState(next);
    writeStoredString(CODE_FONT_STORAGE_KEY, next);
  }, []);

  return { font, hydrated, setFont };
}
