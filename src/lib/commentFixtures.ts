import type { CommentListEntry, CommentListSection } from './comments.ts';

// The comment shapes the tests build. Test-only, so nothing here reaches a
// bundle. Both test files need the same shapes, and a `CommentListEntry` has
// eleven required fields — two copies meant every field added to the interface
// had to be added twice, which is how `messages` came to be missing from one.

/**
 * One thread, everything defaulted and anything overridable. `messages` follows
 * the key, author and body it resolves to, the way the real builder makes them
 * agree; a caller wanting a conversation passes `messages` itself.
 */
export function commentThread(
  overrides: Partial<CommentListEntry> = {}
): CommentListEntry {
  const key = overrides.key ?? 'k1';
  const author = overrides.author ?? 'you';
  const body = overrides.body ?? 'hello';
  return {
    itemId: 'src/a.ts',
    path: 'src/a.ts',
    key,
    author,
    authorIsBot: false,
    body,
    replyCount: 0,
    messages: [{ key, author, body }],
    participants: [author],
    lineNumber: 2,
    lineType: 'change',
    side: 'additions',
    range: { start: 2, end: 2, side: 'additions', endSide: 'additions' },
    ...overrides,
  };
}

/** One file's section. The path is the item id, as it is where these are built. */
export function commentSection(
  path: string,
  threads: CommentListEntry[],
  fileOrder = 0
): CommentListSection {
  return { itemId: path, path, fileOrder, threads };
}
