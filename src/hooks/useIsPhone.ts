import { useSyncExternalStore } from 'react';

// Is this a phone held upright?
//
// The figure is `--breakpoint-phone` in `src/globals.css`, stated again here
// because a media query in CSS and a media query in JavaScript cannot read one
// custom property between them. Change one and change the other: the layout the
// stylesheet draws and the defaults this answer picks are about the same screen.
//
// The server has no window and answers `false`, which is the wide layout — the
// same first paint every other screen gets. Nothing that reads this is on
// screen before the diff is, so there is no flash to settle in the document
// head the way `WatchedReposScript` settles the left bar's.

const PHONE_QUERY = '(width < 30rem)';

// Both events, because either one alone has a case it misses. `change` is the
// precise one and fires once when the answer actually flips — a phone turned on
// its side. `resize` is the coarse one, and it is here because `change` is not
// delivered under every viewport a browser can be given: a window emulated
// through the devtools protocol flips `matches` and dispatches nothing, which
// leaves the layout answering for a width the window no longer has. Two
// listeners and one snapshot: React reads the query itself, so a spurious wake
// costs a comparison and nothing more.
function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener('change', onChange);
  window.addEventListener('resize', onChange);
  return () => {
    query.removeEventListener('change', onChange);
    window.removeEventListener('resize', onChange);
  };
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false
  );
}
