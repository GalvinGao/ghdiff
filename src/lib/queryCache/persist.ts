// What of an answer may be written to disk.
//
// A signed attachment address lasts five minutes and is a credential for a
// private file while it does, so it never reaches the store. The answer is kept
// without it, and marked incomplete: a tab may draw it while the fresh fetch is
// on its way, but never take it in place of one.

/**
 * Any object, so an answer whose type has no `attachments` at all is accepted
 * and handed back unchanged — which is also what marks its record whole.
 */
export function withoutAttachments<T extends object>(value: T): T {
  if (!('attachments' in value) || value.attachments === undefined) {
    return value;
  }
  const { attachments: _signed, ...rest } = value;
  return rest as T;
}

export function entriesWithoutAttachments<T extends object>(
  entries: readonly T[]
): T[] {
  return entries.map((entry) => withoutAttachments(entry));
}
