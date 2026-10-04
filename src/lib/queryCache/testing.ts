// Stand-ins for the browser's channel and store, for the tests beside this
// file. Nothing outside a test imports this.

import type { CacheMessage, MessageBus } from './messages.ts';
import type { BlobMeta, CacheRecord } from './records.ts';
import type { CacheStore } from './store.ts';

/**
 * A channel between any number of tabs in one process. A message reaches every
 * tab but its sender, on a later task, the way `BroadcastChannel` delivers it.
 */
export function busHub(): { join(): MessageBus; sent: CacheMessage[] } {
  const members = new Set<Set<(message: CacheMessage) => void>>();
  const sent: CacheMessage[] = [];
  return {
    sent,
    join() {
      const listeners = new Set<(message: CacheMessage) => void>();
      members.add(listeners);
      return {
        post(message) {
          sent.push(message);
          const copy = structuredClone(message);
          for (const member of members) {
            if (member === listeners) continue;
            setTimeout(() => {
              for (const listener of member) listener(copy);
            }, 0);
          }
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        close() {
          members.delete(listeners);
        },
      };
    },
  };
}

/** A store held in a map, shared by every tab that opens it. */
export function memoryStore(): CacheStore & {
  records: Map<string, CacheRecord>;
  blobs: Map<string, { meta: BlobMeta; text: string }>;
} {
  const records = new Map<string, CacheRecord>();
  const blobs = new Map<string, { meta: BlobMeta; text: string }>();
  return {
    records,
    blobs,
    getBlob: (id) => Promise.resolve(structuredClone(blobs.get(id))),
    putBlob: (meta, text) => {
      blobs.set(meta.id, { meta: structuredClone(meta), text });
      return Promise.resolve();
    },
    blobMetas: () =>
      Promise.resolve([...blobs.values()].map((blob) => ({ ...blob.meta }))),
    putBlobMeta: (meta) => {
      const blob = blobs.get(meta.id);
      if (blob != null) blob.meta = structuredClone(meta);
      return Promise.resolve();
    },
    removeBlobs: (ids) => {
      for (const id of ids) blobs.delete(id);
      return Promise.resolve();
    },
    get: (id) => Promise.resolve(structuredClone(records.get(id))),
    all: () => Promise.resolve([...records.values()].map((r) => ({ ...r }))),
    put: (record) => {
      // The same rule as the IndexedDB store: a later-begun fetch is kept.
      const held = records.get(record.id)?.startedAt ?? -Infinity;
      if (held <= (record.startedAt ?? -Infinity)) {
        records.set(record.id, structuredClone(record));
      }
      return Promise.resolve();
    },
    remove: (ids) => {
      for (const id of ids) records.delete(id);
      return Promise.resolve();
    },
    clear: () => {
      records.clear();
      blobs.clear();
      return Promise.resolve();
    },
    close: () => undefined,
  };
}

/** Lets every queued message and settled promise run. */
export function settle(ms = 5): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits until `ready` holds, a task at a time, for a test that races. */
export async function until(ready: () => boolean, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('The condition never held.');
    await settle(1);
  }
}
