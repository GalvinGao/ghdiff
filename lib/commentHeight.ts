// How tall a collapsed comment card is.
//
// @pierre/diffs observes each annotation element with a ResizeObserver and
// relays out the virtualized list when one changes size. So a comment card must
// pick its height ONCE, from the text, and never change it: the expanded view
// lives in an overlay outside the CodeView's layout instead of growing in
// place. That keeps the diff's layout work constant no matter what a comment
// contains, and it makes a loading image harmless, because the container
// clips rather than grows.
//
// The buckets come from the raw body, with no DOM measurement, so the height is
// known before the first paint.

export type CommentSize = 'one-line' | 'short' | 'tall';

export interface CommentSizeSpec {
  size: CommentSize;
  /** Height of the body region in pixels, excluding the card header. */
  bodyHeight: number;
}

const ONE_LINE = 22;
const SHORT = 66;
const TALL = 132;

/** A fence, table, list, or image needs room, whatever the character count. */
const BLOCK_MARKDOWN = /(^|\n)\s*(```|~~~|\||[-*+]\s|\d+\.\s|>|#{1,6}\s)|!\[/;

export function measureCommentBody(body: string): CommentSizeSpec {
  const trimmed = body.trim();
  const lineCount = trimmed.split('\n').length;

  if (BLOCK_MARKDOWN.test(trimmed)) {
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
 * Plain text for a preview line. The sidebar shows one line per comment, where
 * rendered markdown would be noise, so the marks are stripped rather than
 * rendered.
 */
export function commentPreviewText(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' code ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' image ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/(\*\*|__|~~|\*|_)/g, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
