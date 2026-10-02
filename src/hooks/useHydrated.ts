import { useSyncExternalStore } from 'react';

// Whether this render is past hydration.
//
// A remembered setting is read out of browser storage once, by the first
// component that asks, and the store holds it from then on. A part of the page
// that hydrates later — a lazily loaded route — therefore meets the stored
// value on its hydration pass while the server rendered the fallback, and
// React throws the whole tree away over the difference. A part that is not on
// screen until it is opened can wait for this instead and render nothing
// stored until it is true.
//
// The server snapshot is what a hydration pass reads, so the answer is `false`
// there and `true` on every render after it.

const subscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
