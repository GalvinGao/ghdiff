// Text for the clipboard that does not exist yet when the reviewer presses.
//
// A browser lets a page write the clipboard only from inside a press, and
// Safari holds that line exactly: a write started once a request has come back
// is a write after the press has ended, and it is refused. So the write starts
// in the press and is handed a promise of its text, which is what
// `ClipboardItem` takes a promise for. Chrome and Firefox wait on it the same
// way. A browser with no `ClipboardItem` waits for the text and then writes it,
// which is what it would have allowed anyway.

/**
 * Starts a clipboard write for text that arrives later, and answers whether it
 * landed. Call it synchronously inside the press. A promise that resolves with
 * nothing writes nothing and answers false.
 */
export async function copyWhenReady(
  text: Promise<string | undefined>
): Promise<boolean> {
  const clipboard =
    typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (clipboard == null) return false;

  if (typeof ClipboardItem !== 'undefined') {
    const blob = text.then((value) => {
      if (value == null) throw new Error('Nothing to copy.');
      return new Blob([value], { type: 'text/plain' });
    });
    // The write can be refused before the text arrives, and then nothing else
    // would ever read this rejection.
    blob.catch(() => undefined);
    try {
      await clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return true;
    } catch {
      return false;
    }
  }

  const value = await text;
  if (value == null) return false;
  try {
    await clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
