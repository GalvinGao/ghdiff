import type { CodeViewOptions } from '@pierre/diffs';
import { useMemo } from 'react';

import {
  applyImagePreviews,
  disposeImagePreviews,
  IMAGE_PREVIEWS_CSS,
} from '@/components/diffImagePreviews';

export function useImagePreviews<Metadata>(
  options: CodeViewOptions<Metadata>
): CodeViewOptions<Metadata> {
  return useMemo(
    () => ({
      ...options,
      unsafeCSS: (options.unsafeCSS ?? '') + IMAGE_PREVIEWS_CSS,
      onPostRender(...args) {
        const [node, , phase] = args;
        if (node != null) {
          if (phase === 'unmount') disposeImagePreviews(node);
          else applyImagePreviews(node);
        }
        if (options.onPostRender != null)
          Reflect.apply(options.onPostRender, undefined, args);
      },
    }),
    [options]
  );
}
