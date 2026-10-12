import { useEffect } from 'react';

import type { CheckState } from '@/lib/pullStatus';
import {
  reviewFaviconDataUri,
  type ReviewFaviconColors,
} from '@/lib/reviewFavicon';
import type { ReviewTabType } from '@/lib/reviewTarget';

// The tokens the glyph colours are read from, so `globals.css` stays the one
// place a hex is stated and the tab follows the scheme it is painted in.
const COLOR_TOKENS: Record<keyof ReviewFaviconColors, string> = {
  accent: '--app-accent',
  accentInk: '--app-accent-ink',
  success: '--app-status-success',
  pending: '--app-status-pending',
  failure: '--app-status-failure',
};

/**
 * The browser tab's favicon, repainted for the review on screen: the runner
 * emoji badged with the kind of diff and, once the pull request's details
 * answer, the head commit's checks. The write goes straight onto the `link`
 * element and the cleanup puts the static favicon back, the way
 * `usePaneWidth` writes onto its own node and tells React nothing.
 *
 * The hexes are read off the CSS tokens at paint time, and the repaint hangs
 * on the scheme attribute rather than a prop: a flip lands there from the
 * toggle, from the platform, and from another tab, each through a path of
 * its own, and an effect that read the tokens before the attribute turned
 * would keep the old scheme's colours.
 */
export function useReviewFavicon(input: {
  type: ReviewTabType;
  draft?: boolean;
  check?: CheckState;
}): void {
  const { type, draft, check } = input;
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link == null) return undefined;
    const previous = link.href;
    const paint = () => {
      const styles = getComputedStyle(document.documentElement);
      const colors = {} as ReviewFaviconColors;
      for (const [key, token] of Object.entries(COLOR_TOKENS)) {
        colors[key as keyof ReviewFaviconColors] = styles
          .getPropertyValue(token)
          .trim();
      }
      link.href = reviewFaviconDataUri({ type, draft, check, colors });
    };
    paint();
    // The tokens turn when `data-color-scheme` does, whoever wrote it.
    const observer = new MutationObserver(paint);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-color-scheme'],
    });
    return () => {
      observer.disconnect();
      link.href = previous;
    };
  }, [type, draft, check]);
}
