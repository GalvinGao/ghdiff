import type { CodeViewOptions } from '@pierre/diffs';
import { useMemo } from 'react';

import {
  applyColorPreviews,
  COLOR_PREVIEWS_CSS,
  disposeColorPreviews,
} from '@/components/diffColorPreviews';

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
