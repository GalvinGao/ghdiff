// The IndexedDB half of the shared cache: one database, one object store, one
// record per query per account. Written by hand rather than through a wrapper
// library, because five promises over `IDBRequest` are all it takes and the
// Worker's bundle budget is better spent elsewhere.

import type { CacheRecord } from './records.ts';

const DATABASE = 'ghdiff-cache';
const DATABASE_VERSION = 1;
const RECORDS = 'records';

export interface CacheStore {
  get(id: string): Promise<unknown>;
  all(): Promise<unknown[]>;
  /**
   * Writes a record unless the one stored under its id comes from a fetch
   * that began later. The read and the write are one transaction, and
   * IndexedDB runs two read-write transactions over one store one after the
   * other, so two tabs writing the same question cannot interleave.
   */
  put(record: CacheRecord): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('error', () => reject(transaction.error));
    transaction.addEventListener('abort', () => reject(transaction.error));
  });
}

/**
 * The store, or nothing when the browser will not give one: no IndexedDB at
 * all, storage blocked by a setting, or an open that fails. Nothing is the
 * answer every caller already has to handle, and it means the cache lives in
 * memory for this tab alone, which is what it did before there was a store.
 */
export async function openCacheStore(): Promise<CacheStore | undefined> {
  if (typeof indexedDB === 'undefined') return undefined;
  let database: IDBDatabase;
  try {
    const request = indexedDB.open(DATABASE, DATABASE_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORDS)) {
        db.createObjectStore(RECORDS, { keyPath: 'id' });
      }
    });
    database = await settle(request);
  } catch {
    return undefined;
  }
  // A newer build that raises the version asks every open tab to let go, or
  // its upgrade waits for them for ever.
  database.addEventListener('versionchange', () => database.close());

  const write = async (run: (store: IDBObjectStore) => void) => {
    const transaction = database.transaction(RECORDS, 'readwrite');
    run(transaction.objectStore(RECORDS));
    await finished(transaction);
  };

  return {
    get: (id) =>
      settle(database.transaction(RECORDS).objectStore(RECORDS).get(id)),
    all: () =>
      settle(database.transaction(RECORDS).objectStore(RECORDS).getAll()),
    put: (record) =>
      write((store) => {
        const existing = store.get(record.id);
        existing.addEventListener('success', () => {
          const held = existing.result as { startedAt?: unknown } | undefined;
          const heldFrom =
            typeof held?.startedAt === 'number' ? held.startedAt : -Infinity;
          if (heldFrom <= (record.startedAt ?? -Infinity)) store.put(record);
        });
      }),
    remove: (ids) =>
      ids.length === 0
        ? Promise.resolve()
        : write((store) => {
            for (const id of ids) store.delete(id);
          }),
    clear: () => write((store) => store.clear()),
    close: () => database.close(),
  };
}
