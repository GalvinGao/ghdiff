// How tall a collapsed thread card is.
//
// @pierre/diffs observes each annotation element with a ResizeObserver and
// relays out the virtualized list when one changes size. So a card must pick
// its height ONCE, from the text, and never change it: the expanded view lives
// in an overlay outside the CodeView's layout instead of growing in place.
// That keeps the diff's layout work constant no matter what a thread contains,
// and it makes a loading image harmless, because the container clips rather
// than grows.
//
// The buckets come from the raw text, with no DOM measurement, so the height is
// known before the first paint. They are deliberately small: the card is a
// preview that invites a click, not the place a conversation is read.

export type CommentSize = 'one-line' | 'short' | 'tall';

export interface CommentSizeSpec {
  size: CommentSize;
  /** Height of the body region in pixels, excluding the card header. */
  bodyHeight: number;
}

const ONE_LINE = 20;
const SHORT = 44;
const TALL = 76;

/** A fence, table, list, quote, heading, or image needs room. */
const BLOCK_MARKDOWN = /(^|\n)\s*(```|~~~|\||[-*+]\s|\d+\.\s|>|#{1,6}\s)|!\[/;

/**
 * The same, written as HTML. GitHub's editor puts an attached screenshot in an
 * `<img>` and folds a long note into `<details>`, and CommentBody renders both
 * now, so a body carrying one needs the same room as its markdown twin.
 */
const BLOCK_HTML =
  /<(img|details|table|picture|video|pre|blockquote|[uo]l)[\s>]/i;

export function measureCommentBody(body: string): CommentSizeSpec {
  const trimmed = body.trim();
  const lineCount = trimmed.split('\n').length;

  if (BLOCK_MARKDOWN.test(trimmed) || BLOCK_HTML.test(trimmed)) {
    return { size: 'tall', bodyHeight: TALL };
  }
  if (lineCount === 1 && trimmed.length <= 72) {
    return { size: 'one-line', bodyHeight: ONE_LINE };
  }
  if (lineCount <= 3 && trimmed.length <= 240) {
    return { size: 'short', bodyHeight: SHORT };
  }
  return { size: 'tall', bodyHeight: TALL };
}

/**
 * The collapsed height for a whole thread. A thread with replies is always
 * clipped, because the card shows the opening message and says how many
 * answers follow, so it takes the tall bucket and stops there.
 */
export function measureThread(bodies: readonly string[]): CommentSizeSpec {
  if (bodies.length === 0) {
    return { size: 'one-line', bodyHeight: ONE_LINE };
  }
  const root = measureCommentBody(bodies[0]);
  if (bodies.length === 1) return root;
  return { size: 'tall', bodyHeight: Math.max(root.bodyHeight, SHORT) };
}

/**
 * Plain text for a preview line. The sidebar shows a fixed-height row per
 * thread, where rendered markdown would be noise, so the marks are stripped
 * rather than rendered.
 */
export function commentPreviewText(body: string): string {
  return (
    body
      .replace(/```[\s\S]*?```/g, ' code ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' image ')
      // An HTML image is named the same way its markdown twin is. Stripping the
      // tag alone would leave a row saying nothing at all, since the whole
      // comment is often one screenshot.
      .replace(/<img\b[^>]*>/gi, ' image ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/(\*\*|__|~~|\*|_)/g, '')
      .replace(/<\/?[a-zA-Z][^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
