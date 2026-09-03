import { type CodeFontId, DEFAULT_CODE_FONT, isCodeFont } from './codeFonts.ts';
import {
  type CommentAuthorFilter,
  DEFAULT_COMMENT_AUTHOR_FILTER,
  isCommentAuthorFilter,
} from './commentAuthors.ts';
import { dedupeWatchedRepos, type WatchedRepo } from './pulls.ts';
import {
  CODE_FONT_STORAGE_KEY,
  COLOR_MODE_STORAGE_KEY,
  COMMENT_AUTHOR_FILTER_STORAGE_KEY,
  RAIL_COLLAPSED_STORAGE_KEY,
  RAIL_WIDTH_STORAGE_KEY,
  SIDEBAR_WIDTH_STORAGE_KEY,
  VIEWER_CONTROLS_STORAGE_KEY,
  WATCH_OFFER_STORAGE_KEY,
  WATCHED_REPOS_STORAGE_KEY,
} from './storageKeys.ts';
import { acceptViewerControls, type ViewerControls } from './viewerControls.ts';

// Every setting the browser remembers, named once.
//
// A preference is a key, a fallback, and the two directions between the value
// the app holds and the one string a browser can keep. Stating the four
// together is what lets `src/hooks/preferences.ts` be one generic layer over
// all of them rather than a hook per setting, and it is what makes the read
// testable: a value from storage is untrusted input, written by a build that
// may be older than this one, and every codec below is asked to prove it can
// refuse.
//
// The encodings are the ones already in use, and they are not free to change.
// Three of these keys are read before the first paint by a script in the
// document head — the colour mode, the code font and the watch list — and a
// reviewer's stored value has to go on reading correctly across a deploy. So a
// value that was written bare stays bare, and one that was written as JSON
// stays JSON. This module is imported by those scripts' own module graph, so it
// must stay free of any browser-only import.

/**
 * One remembered setting.
 *
 * `decode` answers `undefined` for anything this build does not accept, which
 * the caller reads as the fallback. `encode` answers `null` to say the key
 * should be removed, which is how a setting expresses having no value — a
 * cleared token is the one that does.
 */
export interface PreferenceCodec<T> {
  key: string;
  fallback: T;
  decode(raw: string): T | undefined;
  encode(value: T): string | null;
}

/**
 * A setting kept as JSON, which is anything that is not a single word.
 *
 * A stored string that is not JSON at all reads as the fallback rather than
 * throwing: the browser's copy is the one input this app cannot version.
 */
function jsonPreference<T>(
  key: string,
  fallback: T,
  accept: (value: unknown) => T | undefined
): PreferenceCodec<T> {
  return {
    key,
    fallback,
    decode(raw) {
      try {
        return accept(JSON.parse(raw));
      } catch {
        return undefined;
      }
    },
    encode: (value) => JSON.stringify(value),
  };
}

/** A setting kept as the bare word, which is what a pre-paint script reads. */
function wordPreference<T extends string>(
  key: string,
  fallback: T,
  accept: (value: string) => value is T
): PreferenceCodec<T> {
  return {
    key,
    fallback,
    decode: (raw) => (accept(raw) ? raw : undefined),
    encode: (value) => value,
  };
}

/** A width one pane was dragged to. `null` is a pane nobody has dragged. */
function paneWidthPreference(key: string): PreferenceCodec<number | null> {
  return jsonPreference<number | null>(key, null, (value) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.round(value)
      : null
  );
}

/** Which of the two schemes the app paints, or the platform's own answer. */
export type ColorMode = 'system' | 'light' | 'dark';

export function isColorMode(value: unknown): value is ColorMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

export const COLOR_MODE_PREFERENCE = wordPreference<ColorMode>(
  COLOR_MODE_STORAGE_KEY,
  'system',
  isColorMode
);

export const CODE_FONT_PREFERENCE = wordPreference<CodeFontId>(
  CODE_FONT_STORAGE_KEY,
  DEFAULT_CODE_FONT,
  isCodeFont
);

/** No repository, as one reference every list's fallback can keep. */
const NO_WATCHED_REPOS: WatchedRepo[] = [];

/**
 * A list of repositories, which two settings now are: the watch list, and the
 * repositories the watch-list offer has already been made for.
 *
 * An entry that is not `{ owner, repo }` is dropped rather than refused, so one
 * bad row does not cost a reviewer the rest of their list. A stored value that
 * is not an array at all is refused, which is what carries the offer's own
 * history across this change: it held `true` or `false` for one deploy, and
 * neither is an array, so an older browser reads as the empty list and is
 * offered the repository it is looking at once more. That is one dialog, once,
 * and the alternative was a second key to remember a shape that lived for
 * an afternoon.
 */
function repoListPreference(key: string): PreferenceCodec<WatchedRepo[]> {
  return jsonPreference<WatchedRepo[]>(key, NO_WATCHED_REPOS, (value) => {
    if (!Array.isArray(value)) return undefined;
    const repos: WatchedRepo[] = [];
    for (const entry of value as unknown[]) {
      if (typeof entry !== 'object' || entry == null) continue;
      const { owner, repo } = entry as Record<string, unknown>;
      if (typeof owner !== 'string' || typeof repo !== 'string') continue;
      if (owner.length === 0 || repo.length === 0) continue;
      repos.push({ owner, repo });
    }
    return dedupeWatchedRepos(repos);
  });
}

export const WATCHED_REPOS_PREFERENCE = repoListPreference(
  WATCHED_REPOS_STORAGE_KEY
);

/**
 * How the diff is drawn. `null` is a reviewer who has touched none of those
 * controls, which is the one reading that lets a phone answer with its own
 * default — see `defaultViewerControls`.
 */
export const VIEWER_CONTROLS_PREFERENCE = jsonPreference<ViewerControls | null>(
  VIEWER_CONTROLS_STORAGE_KEY,
  null,
  (value) => acceptViewerControls(value) ?? null
);

/**
 * The repositories the watch-list offer has already been made for.
 *
 * Per repository and not once per browser, because declining is an answer about
 * the repository on screen and not about the feature: a reviewer who says no to
 * one is still worth asking about the next. An empty list is a reviewer who has
 * never been asked, which is the reading that lets the offer happen at all.
 *
 * It is a record of the asking and not of the answer, so Add lands here beside
 * Not now. That costs nothing — the offer only reaches a reviewer whose watch
 * list is empty, and Add is what fills it — and it buys the case an `onClose`
 * cannot cover: a reviewer who closes the tab with the window open has been
 * asked, and this is what remembers it.
 *
 * Nothing trims it. A reviewer who declines for every repository they ever open
 * accumulates a row apiece, and forty bytes per row against a five megabyte
 * store is not a reason to invent a cap whose whole effect would be to ask
 * somebody twice.
 */
export const WATCH_OFFER_PREFERENCE = repoListPreference(
  WATCH_OFFER_STORAGE_KEY
);

export const RAIL_COLLAPSED_PREFERENCE = jsonPreference<boolean>(
  RAIL_COLLAPSED_STORAGE_KEY,
  false,
  (value) => (typeof value === 'boolean' ? value : undefined)
);

export const COMMENT_AUTHOR_FILTER_PREFERENCE =
  jsonPreference<CommentAuthorFilter>(
    COMMENT_AUTHOR_FILTER_STORAGE_KEY,
    DEFAULT_COMMENT_AUTHOR_FILTER,
    (value) => (isCommentAuthorFilter(value) ? value : undefined)
  );

export const SIDEBAR_WIDTH_PREFERENCE = paneWidthPreference(
  SIDEBAR_WIDTH_STORAGE_KEY
);

export const RAIL_WIDTH_PREFERENCE = paneWidthPreference(
  RAIL_WIDTH_STORAGE_KEY
);
