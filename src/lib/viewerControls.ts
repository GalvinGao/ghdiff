import type { DiffIndicators } from '@pierre/diffs';

// How the diff is drawn, which is the reviewer's own set of answers.
//
// The viewer takes these one at a time. They are gathered into one object
// because they are remembered as one: a reviewer who reads unified with no
// backgrounds has said one thing about how they read a diff, and a browser that
// remembered the columns and forgot the backgrounds would be answering half of
// it.
//
// The shape is here rather than beside the viewer so the read of a stored one
// can be tested without a component around it. Every field is checked on the
// way in, because storage holds whatever an older build wrote there.

export interface ViewerControls {
  diffStyle: 'split' | 'unified';
  diffIndicators: DiffIndicators;
  overflow: 'wrap' | 'scroll';
  lineNumbers: boolean;
  backgrounds: boolean;
  /** Dim a changed line whose two sides differ only in whitespace. */
  dimWhitespace: boolean;
}

export const DEFAULT_VIEWER_CONTROLS: ViewerControls = {
  diffStyle: 'split',
  diffIndicators: 'bars',
  overflow: 'scroll',
  lineNumbers: true,
  backgrounds: true,
  dimWhitespace: true,
};

/** The same set with the one field a phone answers differently. */
const PHONE_VIEWER_CONTROLS: ViewerControls = {
  ...DEFAULT_VIEWER_CONTROLS,
  diffStyle: 'unified',
};

/**
 * What the viewer starts on, before the reviewer has said otherwise.
 *
 * Two columns of code on a phone is about twenty characters each, which is not
 * reading a diff — it is guessing at one. So a phone starts unified. It is a
 * default and nothing more: the control in the header writes the choice to
 * storage, and from that press this function is not consulted again, so a
 * reviewer who asks for split on a phone keeps it — this visit and the next.
 */
export function defaultViewerControls(isPhone: boolean): ViewerControls {
  return isPhone ? PHONE_VIEWER_CONTROLS : DEFAULT_VIEWER_CONTROLS;
}

function isDiffIndicators(value: unknown): value is DiffIndicators {
  return value === 'classic' || value === 'bars' || value === 'none';
}

/**
 * Reads a stored set back.
 *
 * Each field is taken on its own and falls back to the default on its own,
 * which is deliberate: this object gains fields as the header gains controls,
 * and a set stored by yesterday's build is still right answers plus one
 * absence. Refusing the whole object over the one missing field would throw
 * the rest away.
 *
 * `undefined` is the answer when the stored value says nothing about any of
 * the fields — it is not an object, or it is an object with none of them in a
 * readable state. That is not the same answer as the default set: a reviewer
 * who has chosen nothing lets the screen pick, and a phone picks unified.
 */
export function acceptViewerControls(
  value: unknown
): ViewerControls | undefined {
  if (typeof value !== 'object' || value == null) return undefined;
  const stored = value as Partial<Record<keyof ViewerControls, unknown>>;
  let read = 0;
  const take = <T>(accepted: boolean, field: T, fallback: T): T => {
    if (!accepted) return fallback;
    read += 1;
    return field;
  };
  const controls: ViewerControls = {
    diffStyle: take(
      stored.diffStyle === 'split' || stored.diffStyle === 'unified',
      stored.diffStyle as ViewerControls['diffStyle'],
      DEFAULT_VIEWER_CONTROLS.diffStyle
    ),
    diffIndicators: take(
      isDiffIndicators(stored.diffIndicators),
      stored.diffIndicators as DiffIndicators,
      DEFAULT_VIEWER_CONTROLS.diffIndicators
    ),
    overflow: take(
      stored.overflow === 'wrap' || stored.overflow === 'scroll',
      stored.overflow as ViewerControls['overflow'],
      DEFAULT_VIEWER_CONTROLS.overflow
    ),
    lineNumbers: take(
      typeof stored.lineNumbers === 'boolean',
      stored.lineNumbers as boolean,
      DEFAULT_VIEWER_CONTROLS.lineNumbers
    ),
    backgrounds: take(
      typeof stored.backgrounds === 'boolean',
      stored.backgrounds as boolean,
      DEFAULT_VIEWER_CONTROLS.backgrounds
    ),
    dimWhitespace: take(
      typeof stored.dimWhitespace === 'boolean',
      stored.dimWhitespace as boolean,
      DEFAULT_VIEWER_CONTROLS.dimWhitespace
    ),
  };
  return read === 0 ? undefined : controls;
}
