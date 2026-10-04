// What the tabs of one browser say to each other about the cache, and the one
// channel they say it on.

export type CacheMessage =
  /** A tab without Web Locks is about to fetch `key`. See `softLease`. */
  | { type: 'lease'; key: string; tab: string }
  /** It has finished, whichever way it ended. */
  | { type: 'release'; key: string; tab: string }
  /**
   * An answer a tab has just fetched. `namespace` is absent while the sender
   * has not yet confirmed whose session it is, which is every tab's first
   * moment — and the moment several tabs opened together most need to share.
   */
  | {
      type: 'data';
      tab: string;
      namespace?: string;
      hash: string;
      queryKey: readonly unknown[];
      data: unknown;
      updatedAt: number;
      /**
       * When the fetch began. Answers are ordered by it and not by when they
       * landed: a read that began before a write can land after it. Absent
       * from an older build's message, which is then ordered by `updatedAt`.
       */
      startedAt?: number;
    }
  /** A tab has confirmed whose session the cookie carries. */
  | { type: 'session'; tab: string; namespace: string }
  /** A tab has ended the session and emptied the store. */
  | { type: 'signed-out'; tab: string };

const MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'lease',
  'release',
  'data',
  'session',
  'signed-out',
]);

/** A message off the channel. Only this origin can post one, but a tab running
    an older build can, so the type is checked before anything reads it. */
export function isCacheMessage(value: unknown): value is CacheMessage {
  if (typeof value !== 'object' || value == null) return false;
  const message = value as { type?: unknown; tab?: unknown };
  return (
    typeof message.type === 'string' &&
    MESSAGE_TYPES.has(message.type) &&
    typeof message.tab === 'string'
  );
}

/** One channel, as the cache and its tests both see it. */
export interface MessageBus {
  post(message: CacheMessage): void;
  subscribe(listener: (message: CacheMessage) => void): () => void;
  close(): void;
}

export const CACHE_CHANNEL = 'ghdiff-cache';

/**
 * The browser's own channel between the tabs of one origin, or nothing where
 * the browser has none. A `BroadcastChannel` never delivers a message to the
 * object that posted it, so a tab does not hear itself.
 */
export function broadcastBus(name = CACHE_CHANNEL): MessageBus | undefined {
  if (typeof BroadcastChannel !== 'function') return undefined;
  const channel = new BroadcastChannel(name);
  const listeners = new Set<(message: CacheMessage) => void>();
  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (!isCacheMessage(event.data)) return;
    for (const listener of listeners) listener(event.data);
  });
  return {
    post: (message) => {
      // A message the structured clone cannot copy is one tab's loss, not a
      // reason to fail the fetch that produced it.
      try {
        channel.postMessage(message);
      } catch {
        // Nothing to say. The other tabs fetch for themselves.
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => {
      listeners.clear();
      channel.close();
    },
  };
}
