import { useEffect } from 'react';

/**
 * The browser tab's title, for as long as the component asking for it is on
 * screen. The root route's document head names the app; a review renames the
 * tab after the diff it shows, and leaving the review gives the name back.
 * The value it came in with — not a constant — is what the cleanup restores,
 * so the answer is right whatever the next screen's own head says.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
