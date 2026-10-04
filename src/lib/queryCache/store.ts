// The IndexedDB half of the shared cache: one database, one record per query
// per account, and beside them the patches and files. Written by hand rather
// than through a wrapper library, because a few promises over `IDBRequest` are
// all it takes and the Worker's bundle budget is better spent elsewhere.
//
// A patch or a file is a blob: its text in one object store and what is known
// about it in another. The two are apart so that sweeping and trimming read
// the small half alone — a startup that read every stored patch to find the
// expired ones would read tens of megabytes to throw most of them away.

import type { BlobMeta, CacheRecord } from './records.ts';

const DATABASE = 'ghdiff-cache';
const DATABASE_VERSION = 2;
const RECORDS = 'records';
const BLOB_META = 'blobMeta';
const BLOB_TEXT = 'blobText';

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
  getBlob(id: string): Promise<{ meta: unknown; text: unknown } | undefined>;
  putBlob(meta: BlobMeta, text: string): Promise<void>;
  blobMetas(): Promise<unknown[]>;
  /** Writes what is known about a blob, and leaves its text alone. */
  putBlobMeta(meta: BlobMeta): Promise<void>;
  removeBlobs(ids: readonly string[]): Promise<void>;
  /** Empties every store: the records and the blobs alike. */
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
      for (const name of [RECORDS, BLOB_META, BLOB_TEXT]) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
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
  /** One transaction over both halves of the blobs, so they never disagree. */
  const writeBlobs = async (
    run: (meta: IDBObjectStore, text: IDBObjectStore) => void
  ) => {
    const transaction = database.transaction(
      [BLOB_META, BLOB_TEXT],
      'readwrite'
    );
    run(transaction.objectStore(BLOB_META), transaction.objectStore(BLOB_TEXT));
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
    getBlob: async (id) => {
      const transaction = database.transaction([BLOB_META, BLOB_TEXT]);
      const [meta, text] = await Promise.all([
        settle(transaction.objectStore(BLOB_META).get(id)),
        settle(transaction.objectStore(BLOB_TEXT).get(id)),
      ]);
      if (meta == null || text == null) return undefined;
      return { meta, text: (text as { text?: unknown }).text };
    },
    putBlob: (meta, text) =>
      writeBlobs((metas, texts) => {
        metas.put(meta);
        texts.put({ id: meta.id, text });
      }),
    blobMetas: () =>
      settle(database.transaction(BLOB_META).objectStore(BLOB_META).getAll()),
    putBlobMeta: (meta) => writeBlobs((metas) => metas.put(meta)),
    removeBlobs: (ids) =>
      ids.length === 0
        ? Promise.resolve()
        : writeBlobs((metas, texts) => {
            for (const id of ids) {
              metas.delete(id);
              texts.delete(id);
            }
          }),
    clear: async () => {
      const transaction = database.transaction(
        [RECORDS, BLOB_META, BLOB_TEXT],
        'readwrite'
      );
      for (const name of [RECORDS, BLOB_META, BLOB_TEXT]) {
        transaction.objectStore(name).clear();
      }
      await finished(transaction);
    },
    close: () => database.close(),
  };
}
