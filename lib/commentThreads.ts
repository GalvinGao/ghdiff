import type { CommentPayload, ThreadComment } from './comments.ts';

// Grouping GitHub review comments into threads.
//
// GitHub returns a flat list. A reply carries `replyToId` pointing at the
// comment it answers, which may itself be a reply, so the root is found by
// walking that chain. On troph-team/lilja#584 this turns 28 rows into 9
// threads, which is 9 cards in the diff instead of 28.

export interface RawThread {
  /** Identifies the thread: the root's GitHub id, or its own key. */
  key: string;
  /** The root first, then replies oldest first. */
  comments: CommentPayload[];
}

function payloadKey(payload: CommentPayload, index: number): string {
  return payload.githubId != null ? `gh-${payload.githubId}` : `local-${index}`;
}

/**
 * Resolves each comment to the root of its thread, then groups. Threads keep
 * the order in which their roots appeared, and replies sort by creation time so
 * a conversation reads top to bottom.
 */
export function groupCommentThreads(
  payloads: readonly CommentPayload[]
): RawThread[] {
  const byId = new Map<number, CommentPayload>();
  for (const payload of payloads) {
    if (payload.githubId != null) byId.set(payload.githubId, payload);
  }

  const rootOf = (payload: CommentPayload): CommentPayload => {
    let current = payload;
    // A malformed chain must not loop forever, so the walk is bounded by the
    // number of comments it could possibly pass through.
    for (let hops = 0; hops <= payloads.length; hops++) {
      const parentId = current.replyToId;
      if (parentId == null) return current;
      const parent = byId.get(parentId);
      // A reply whose parent is missing from this page becomes its own root,
      // so it is shown rather than dropped.
      if (parent == null || parent === current) return current;
      current = parent;
    }
    return current;
  };

  // Index once. Looking a root's position up per comment would make grouping
  // quadratic, which matters on a review with thousands of comments.
  const indexOf = new Map<CommentPayload, number>();
  for (const [index, payload] of payloads.entries()) {
    indexOf.set(payload, index);
  }

  const threads = new Map<string, RawThread>();
  const order: string[] = [];

  for (const [index, payload] of payloads.entries()) {
    const root = rootOf(payload);
    const key = payloadKey(root, indexOf.get(root) ?? index);
    let thread = threads.get(key);
    if (thread == null) {
      thread = { key, comments: [] };
      threads.set(key, thread);
      order.push(key);
    }
    thread.comments.push(payload);
  }

  for (const thread of threads.values()) {
    thread.comments.sort((a, b) => {
      // The root always leads, whatever the timestamps say.
      const aRoot = a.replyToId == null ? 0 : 1;
      const bRoot = b.replyToId == null ? 0 : 1;
      if (aRoot !== bRoot) return aRoot - bRoot;
      return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
    });
  }

  return order.map((key) => {
    const thread = threads.get(key);
    if (thread == null) throw new Error('Unreachable: key came from order.');
    return thread;
  });
}

/** Converts one grouped thread into the messages a card renders. */
export function threadComments(thread: RawThread): ThreadComment[] {
  return thread.comments.map((payload, index) => ({
    key: payloadKey(payload, index),
    githubId: payload.githubId,
    author: payload.author,
    authorAvatarUrl: payload.authorAvatarUrl,
    body: payload.body,
    createdAt: payload.createdAt,
    htmlUrl: payload.htmlUrl,
  }));
}
