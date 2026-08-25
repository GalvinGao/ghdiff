import type { CodeViewLineSelection, SelectedLineRange } from '@pierre/diffs';
import { useStableCallback } from '@pierre/diffs/react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  buildDiffAnchorIndex,
  buildGitHubDigestIndex,
  type DiffAnchorIndex,
  formatDiffAnchor,
  lookupDiffAnchor,
} from '@/lib/diffAnchor';
import type { ReviewFileEntry } from '@/lib/reviewData';

/**
 * The URL fragment, kept level with the place the reviewer is reading.
 *
 * The address is the one part of a review a reviewer can send to somebody else,
 * so everything that says "here" has to be in it: the file, and the lines
 * inside it. `src/lib/diffAnchor.ts` owns the grammar; this hook owns the two
 * directions.
 *
 * Reading and writing the same fragment would answer each other forever, so
 * `settledRef` holds the fragment this hook last wrote or last read, and each
 * direction stops on it. Two of the four things that change a fragment are this
 * hook's own writes — the reviewer opened a file, the selection in the diff
 * moved. The other two are the browser going back and an edit in the address
 * bar, and those are the ones the reading side has to answer.
 *
 * Scrolling the diff does not write here. The file under the reviewer changes
 * on every wheel notch, and a history entry per notch would make the back
 * button useless. github.com writes on a click and on nothing else, and so does
 * this.
 */

export interface DiffAnchorTarget {
  itemId: string;
  /** Absent when the fragment names a file and no lines in it. */
  range?: SelectedLineRange;
}

export interface DiffAnchorState {
  /**
   * The reviewer opened a file. Writes its fragment and keeps a history entry,
   * so the back button walks the files they opened.
   */
  openItem(itemId: string): void;
  /**
   * The selection in the diff moved. Rewrites the fragment in place: a drag
   * reports every line it crosses, and each one is a refinement of where the
   * reviewer already is rather than somewhere new.
   */
  syncSelection(selection: CodeViewLineSelection | null): void;
}

export function useDiffAnchor(options: {
  /** Every file of the patch, which is what a fragment is resolved against. */
  entries: readonly ReviewFileEntry[];
  /** False until the diff is on screen. Nothing can be applied before that. */
  ready: boolean;
  /**
   * Puts the reviewer where a fragment from the URL says. Called with null for
   * an address with no fragment, which names no lines.
   */
  onApply(target: DiffAnchorTarget | null): void;
}): DiffAnchorState {
  const { entries, ready } = options;
  const hash = useLocation({ select: (location) => location.hash });
  const navigate = useNavigate();
  const apply = useStableCallback(options.onApply);

  const index = useMemo(() => buildDiffAnchorIndex(entries), [entries]);
  const digestsRef = useRef<{
    entries: readonly ReviewFileEntry[];
    digests: Promise<Map<string, string>>;
  } | null>(null);
  // The fragment already accounted for, in either direction, and the files it
  // was accounted for against. A new patch makes the second stale, which is
  // what sends the same fragment through the effect below a second time.
  const settledRef = useRef<string | null>(null);
  const settledIndexRef = useRef<DiffAnchorIndex | null>(null);
  // The file the fragment names now. A selection that goes away leaves the file
  // behind, the way github.com drops the line part and keeps the anchor.
  const itemRef = useRef<string | undefined>(undefined);

  const write = useCallback(
    (next: string, push: boolean) => {
      if (next === settledRef.current) return;
      settledRef.current = next;
      void navigate({
        hash: next,
        replace: !push,
        // The diff is its own scroll region and this hook scrolls it. Letting
        // the router scroll the document as well would fight it, and there is
        // no element with this fragment for it to reach anyway.
        resetScroll: false,
        hashScrollIntoView: false,
      });
    },
    [navigate]
  );

  const openItem = useCallback(
    (itemId: string) => {
      itemRef.current = itemId;
      write(formatDiffAnchor(itemId), true);
    },
    [write]
  );

  const syncSelection = useCallback(
    (selection: CodeViewLineSelection | null) => {
      if (selection != null) {
        itemRef.current = selection.id;
        write(formatDiffAnchor(selection.id, selection.range), false);
        return;
      }
      const itemId = itemRef.current;
      if (itemId == null) return;
      write(formatDiffAnchor(itemId), false);
    },
    [write]
  );

  // A fragment typed into the address bar raises `hashchange` and nothing else.
  // The router listens for `popstate` alone, so without this it would never
  // learn, and the diff would sit where it was while the address said
  // otherwise. Telling the router is enough: the effect below answers.
  useEffect(() => {
    const onHashChange = () => {
      const next = window.location.hash.replace(/^#/, '');
      if (next === settledRef.current) return;
      void navigate({
        hash: next,
        // The browser already made the history entry for the edit.
        replace: true,
        resetScroll: false,
        hashScrollIntoView: false,
      });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [navigate]);

  useEffect(() => {
    if (!ready) return undefined;
    if (hash === settledRef.current && index === settledIndexRef.current) {
      return undefined;
    }
    // A different patch: the file the fragment last named belonged to the one
    // before it, and writing that name again would point at nothing.
    if (index !== settledIndexRef.current) itemRef.current = undefined;
    settledRef.current = hash;
    settledIndexRef.current = index;

    if (hash.length === 0) {
      apply(null);
      return undefined;
    }

    const lookup = lookupDiffAnchor(index, hash);
    // Somebody else's fragment, or a file this diff does not hold. Leave the
    // address as it is and leave the reviewer where they are.
    if (lookup == null) return undefined;

    if (lookup.kind === 'item') {
      itemRef.current = lookup.itemId;
      apply({ itemId: lookup.itemId, range: lookup.range });
      return undefined;
    }

    // A link copied from github.com, which names the file by the digest of its
    // path. Digesting every path is the only way back, so it happens here and
    // not on the way in.
    if (digestsRef.current?.entries !== entries) {
      digestsRef.current = {
        entries,
        digests: buildGitHubDigestIndex(entries),
      };
    }
    const pending = digestsRef.current.digests;
    let cancelled = false;
    void (async () => {
      const digests = await pending;
      if (cancelled) return;
      const itemId = digests.get(lookup.digest);
      if (itemId == null) return;
      itemRef.current = itemId;
      apply({ itemId, range: lookup.range });
    })();
    return () => {
      cancelled = true;
    };
  }, [apply, entries, hash, index, ready]);

  return useMemo(
    () => ({ openItem, syncSelection }),
    [openItem, syncSelection]
  );
}
