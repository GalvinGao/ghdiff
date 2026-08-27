// Reading a response body as text, a chunk at a time.
//
// `response.text()` is one line and answers with the whole body, which is the
// wrong shape for both of the things this app fetches. A patch runs to tens of
// megabytes and a reviewer waits for it with nothing to look at, so the count
// of what has arrived is worth having. A file has a ceiling, and `text()` is
// past it before anything can object.
//
// So one loop serves both: it counts the decoded bytes, hands the figure to
// whoever asked, and stops if it runs past a limit. Decoded and not declared —
// `content-length` counts the bytes on the wire, and GitHub compresses.

export interface StreamTextOptions {
  /**
   * Stop and throw past this many decoded bytes. No limit when absent, which
   * is what a patch needs: 43 MB is a real diff and not a runaway one.
   */
  maxBytes?: number;
  /** The message to throw when `maxBytes` is passed. */
  tooLarge?: string;
  /**
   * The decoded bytes so far, as they arrive. Called once per chunk, which is
   * as often as the network hands one over — a caller that renders this is the
   * one that decides how much of it to act on.
   */
  onBytes?(read: number): void;
}

const DEFAULT_TOO_LARGE = 'That response is too large to read.';

export async function readStreamedText(
  response: Response,
  options: StreamTextOptions = {}
): Promise<string> {
  const { maxBytes, onBytes, tooLarge = DEFAULT_TOO_LARGE } = options;
  const body = response.body;
  // No stream to read means no way to count, and only a runtime with no
  // streaming fetch at all lands here.
  if (body == null) {
    const text = await response.text();
    onBytes?.(text.length);
    return text;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let read = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      if (maxBytes != null && read > maxBytes) throw new Error(tooLarge);
      // `stream: true`, or a character split across two chunks decodes as two
      // replacement characters instead of itself.
      text += decoder.decode(value, { stream: true });
      onBytes?.(read);
    }
  } finally {
    // Releases the lock on the way out, and cancels the rest of the download
    // when this is the throw above rather than the end of the body.
    await reader.cancel().catch(() => undefined);
  }
  return text + decoder.decode();
}
