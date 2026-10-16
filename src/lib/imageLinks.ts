export interface ImageLink {
  start: number;
  end: number;
  url: string;
}

const IMAGE_PATH = /\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;
const URL_TEXT = /https?:\/\/[^\s<>"'`\\]+/gi;
const OPENING: Readonly<Record<string, string>> = {
  ')': '(',
  ']': '[',
  '}': '{',
};
const CLOSING: Readonly<Record<string, string>> = {
  '(': ')',
  '[': ']',
  '{': '}',
};

/** Direct image URLs only; never fetch a page to discover what it contains. */
export function findImageLinks(text: string): ImageLink[] {
  const links: ImageLink[] = [];
  for (const match of text.matchAll(URL_TEXT)) {
    const candidate = match[0];
    let end = candidate.length;
    const enclosingOpen = text[match.index - 1];
    const enclosingClose = CLOSING[enclosingOpen];
    // Bound CSS/Markdown syntax before touching punctuation in signed queries.
    if (enclosingClose != null) {
      let depth = 0;
      for (let i = 0; i < end; i++) {
        if (candidate[i] === enclosingOpen) depth++;
        else if (candidate[i] === enclosingClose) {
          if (depth === 0) {
            end = i;
            break;
          }
          depth--;
        }
      }
    }
    const hasQuery = /[?#]/.test(candidate.slice(0, end));
    const extraClosers = new Map<string, number>();
    // Preserve signed query bytes. Trim prose delimiters in linear time,
    // counting each bracket kind at most once even on a long/minified line.
    while (end > 0) {
      const last = candidate[end - 1];
      if (!hasQuery && '.,;'.includes(last)) {
        end--;
        continue;
      }
      const open = OPENING[last];
      if (open == null || (hasQuery && text[match.index - 1] !== open)) break;
      let extra = extraClosers.get(last);
      if (extra == null) {
        extra = 0;
        for (let i = 0; i < end; i++) {
          const char = candidate[i];
          if (char === last) extra++;
          else if (char === open) extra--;
        }
      }
      if (extra <= 0) break;
      extraClosers.set(last, extra - 1);
      end--;
    }
    const url = candidate.slice(0, end);
    try {
      const parsed = new URL(url);
      if (parsed.username !== '' || parsed.password !== '') continue;
      if (!IMAGE_PATH.test(decodeURIComponent(parsed.pathname))) continue;
      links.push({ start: match.index, end: match.index + url.length, url });
    } catch {
      // Incomplete URLs, invalid ports and malformed encoded paths are code too.
    }
  }
  return links;
}
