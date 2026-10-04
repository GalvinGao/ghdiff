// One cache for every tab of the browser, over React Query.
//
// Three parts, and each one degrades on its own. The coordinator decides which
// tab fetches a key when several want it; the channel carries the answer to
// the others the moment it lands; the store keeps it for the next load. A
// browser with none of the three is a tab with an in-memory cache of its own,
// which is what every tab had before this file existed.
//
// The one rule all of it holds to: an answer is never wrong because another tab
// provided it. A tab takes another's answer only when it is younger than the
// query's share window and arrived without this tab asking for it, and the
// store is read only for answers of the account this tab has confirmed.

import type { QueryClient } from '@tanstack/react-query';

import { onSessionEnded } from '../authFetch.ts';
import { type Coordinator, pickCoordinator } from './coordinator.ts';
import {
  broadcastBus,
  type CacheMessage,
  type MessageBus,
} from './messages.ts';
import {
  CACHE_SCHEMA_VERSION,
  type CacheRecord,
  isLiveRecord,
  isWithinWindow,
  queryHash,
  recordId,
  SHARE_WINDOW_MS,
} from './records.ts';
import { type CacheStore, openCacheStore } from './store.ts';

/**
 * Whether an answer goes to disk: `true` as it is, a function for what of it
 * may, and `false` — the default — for not at all. The function answers
 * `undefined` for an answer that must not be kept, such as one that carries a
 * failure: a failure read back on the next load is a failure that load never
 * had.
 */
export type Persist<T> = boolean | ((data: T) => unknown);

export interface SharedFetch<T> {
  queryKey: readonly unknown[];
  signal: AbortSignal;
  fetch: (signal: AbortSignal) => Promise<T>;
  persist?: Persist<T>;
  /** How young another tab's answer must be to take it. */
  shareWindowMs?: number;
}

/**
 * The query that says whose session the cookie carries. Its answer is what
 * confirms an account, so it is never reset by a change of account, and it is
 * never written to disk: a stale answer to "who is this" is the one answer the
 * store must not give.
 */
export const SESSION_QUERY_KEY = ['viewer.get'] as const;
const SESSION_HASH = queryHash(SESSION_QUERY_KEY);

type PendingRecord = Omit<CacheRecord, 'id' | 'namespace'>;

/**
 * How long a tab that waited on another's lock waits again for that tab's
 * message, when the store had nothing for it. The message was posted before the
 * lock was let go, so it is on its way; this is the room it is given to land.
 */
const CHANNEL_GRACE_MS = 50;

export interface SharedCacheEnvironment {
  tab: string;
  coordinator: Coordinator;
  bus?: MessageBus;
  openStore(): Promise<CacheStore | undefined>;
}

export class SharedCache {
  readonly tab: string;
  readonly coordinator: Coordinator;
  private readonly client: QueryClient;
  private readonly bus?: MessageBus;
  private store?: CacheStore;
  /** Settles once the store is open and its records are placed. */
  private readonly ready: Promise<void>;
  /** The account this tab has confirmed, or nothing while it has not. */
  private namespace?: string;
  /**
   * The account whose answers are on screen: the confirmed one, or before that
   * the one the store held at startup. A confirmation that differs from it is
   * a change of account, and resets every answer.
   */
  private shown?: string;
  /** Answers fetched before an account was confirmed, by hash. */
  private readonly pending = new Map<string, PendingRecord>();
  /**
   * Answers this tab received rather than fetched, by hash, with the time each
   * was fetched. Only these may stand in for a fetch.
   */
  private readonly received = new Map<string, number>();
  /** Keys whose next fetch has to reach GitHub, for a reload button. */
  private readonly forced = new Set<string>();
  private readonly cleanups: (() => void)[] = [];

  constructor(client: QueryClient, environment: SharedCacheEnvironment) {
    this.client = client;
    this.tab = environment.tab;
    this.coordinator = environment.coordinator;
    this.bus = environment.bus;
    if (this.bus != null) {
      this.cleanups.push(this.bus.subscribe((message) => this.hear(message)));
    }
    this.ready = this.restore(environment.openStore);
  }

  /** The `queryFn` of every shared query. */
  async fetch<T>(options: SharedFetch<T>): Promise<T> {
    const { fetch, persist = false, queryKey, signal } = options;
    const shareWindowMs = options.shareWindowMs ?? SHARE_WINDOW_MS;
    await this.ready;
    const hash = queryHash(queryKey);
    return await this.coordinator.exclusive(
      hash,
      async (contended) => {
        if (!this.forced.delete(hash)) {
          const taken = await this.takeShared<T>(
            queryKey,
            hash,
            shareWindowMs,
            contended
          );
          if (taken !== undefined) return taken;
        }
        const data = await fetch(signal);
        // Written before the lock is let go, so a tab that waited on it finds
        // the record when its turn comes, whatever the channel has delivered.
        await this.share(queryKey, hash, data, Date.now(), persist);
        return data;
      },
      signal
    );
  }

  /**
   * An answer another tab just fetched, if there is one to take. A tab that
   * did not wait for the lock has nobody to take one from but the last load,
   * so it reads memory and nothing else. A tab that did wait asks twice more,
   * because the browser grants a lock and delivers a message on two separate
   * queues: the store, which the tab before it wrote before letting go, and
   * then the channel, after a moment's grace for its message to land.
   */
  private async takeShared<T>(
    queryKey: readonly unknown[],
    hash: string,
    windowMs: number,
    contended: boolean
  ): Promise<T | undefined> {
    const borrowed = this.borrow<T>(queryKey, hash, windowMs);
    if (borrowed !== undefined || !contended) return borrowed;
    const stored = await this.readFresh<T>(queryKey, hash, windowMs);
    if (stored !== undefined) return stored;
    await new Promise((resolve) => setTimeout(resolve, CHANNEL_GRACE_MS));
    return this.borrow<T>(queryKey, hash, windowMs);
  }

  /** A whole record of this account's, younger than the window and than the
      answer this tab holds. */
  private async readFresh<T>(
    queryKey: readonly unknown[],
    hash: string,
    windowMs: number
  ): Promise<T | undefined> {
    const { namespace, store } = this;
    if (namespace == null || store == null) return undefined;
    let record: unknown;
    try {
      record = await store.get(recordId(namespace, hash));
    } catch {
      return undefined;
    }
    const now = Date.now();
    if (!isLiveRecord(record, now) || !record.complete) return undefined;
    if (!isWithinWindow(record.updatedAt, now, windowMs)) return undefined;
    const held = this.client.getQueryState(queryKey)?.dataUpdatedAt ?? 0;
    if (held >= record.updatedAt) return undefined;
    return record.data as T;
  }

  /** Makes the next fetch of `queryKey` ask GitHub, whatever other tabs hold. */
  forceNext(queryKey: readonly unknown[]): void {
    this.forced.add(queryHash(queryKey));
  }

  /**
   * Puts an answer this tab did not fetch but knows — the result of its own
   * write — into the cache, every other tab, and the store.
   */
  publish<T>(queryKey: readonly unknown[], data: T, persist: Persist<T>) {
    this.client.setQueryData(queryKey, data);
    void this.share(queryKey, queryHash(queryKey), data, Date.now(), persist);
  }

  /**
   * Records whose session the cookie carries, from the session query's answer.
   * The first confirmation writes out what was fetched while waiting for it; a
   * confirmation of a different account than the one on screen resets every
   * answer and deletes every record that is not this account's.
   */
  confirm(namespace: string): void {
    if (namespace === this.namespace) return;
    const previous = this.namespace ?? this.shown;
    this.namespace = namespace;
    this.shown = namespace;
    if (previous != null && previous !== namespace) this.resetAnswers(false);
    const pending = [...this.pending.values()];
    this.pending.clear();
    void this.settleStore(namespace, pending);
    this.bus?.post({ type: 'session', tab: this.tab, namespace });
  }

  /**
   * Stops every write to the store until the next confirmation. Called the
   * moment a sign-out starts, so an answer that lands while the session is
   * ending is not filed under the account that is leaving.
   */
  suspend(): void {
    this.namespace = undefined;
    this.pending.clear();
  }

  /**
   * Empties the store and tells every tab. Called once the session is gone at
   * the Worker and not before: a tab that heard of it earlier would ask who it
   * is, be told the old account by the cookie still standing, and write that
   * account's answers back into the store this just emptied.
   */
  async endSession(): Promise<void> {
    this.suspend();
    this.shown = undefined;
    this.received.clear();
    await this.ready;
    try {
      await this.store?.clear();
    } catch {
      // A store that cannot be cleared still holds a day at most.
    }
    this.bus?.post({ type: 'signed-out', tab: this.tab });
  }

  /** Hands this cache something to undo when it is disposed. */
  adopt(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }

  dispose(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.coordinator.dispose();
    this.bus?.close();
    this.store?.close();
  }

  /** Another tab's answer, when it is young enough and this tab did not ask. */
  private borrow<T>(
    queryKey: readonly unknown[],
    hash: string,
    windowMs: number
  ): T | undefined {
    const fetchedAt = this.received.get(hash);
    if (fetchedAt == null) return undefined;
    if (!isWithinWindow(fetchedAt, Date.now(), windowMs)) return undefined;
    const state = this.client.getQueryState<T>(queryKey);
    if (state?.data === undefined || state.dataUpdatedAt !== fetchedAt) {
      return undefined;
    }
    return state.data;
  }

  private async share<T>(
    queryKey: readonly unknown[],
    hash: string,
    data: T,
    updatedAt: number,
    persist: Persist<T>
  ): Promise<void> {
    this.received.delete(hash);
    this.bus?.post({
      type: 'data',
      tab: this.tab,
      namespace: this.namespace,
      hash,
      queryKey: [...queryKey],
      data,
      updatedAt,
    });
    if (persist === false || hash === SESSION_HASH) return;
    const stored = persist === true ? data : persist(data);
    if (stored === undefined) return;
    const record: PendingRecord = {
      hash,
      queryKey: [...queryKey],
      version: CACHE_SCHEMA_VERSION,
      updatedAt,
      // Whole when nothing was taken out of it, which is also what a function
      // that had nothing to take out hands back.
      complete: stored === data,
      data: stored,
    };
    if (this.namespace == null) {
      this.pending.set(hash, record);
      return;
    }
    await this.write(this.namespace, record);
  }

  private async write(namespace: string, record: PendingRecord) {
    await this.ready;
    try {
      await this.store?.put({
        ...record,
        id: recordId(namespace, record.hash),
        namespace,
      });
    } catch {
      // A full disk or an answer the store cannot copy costs the next load
      // one fetch, and nothing on this one.
    }
  }

  private hear(message: CacheMessage) {
    switch (message.type) {
      case 'data': {
        // A sender that has confirmed a different account fetched with a
        // cookie this tab no longer agrees with. One that has not confirmed
        // yet fetched with the cookie every tab shares, which is the case of
        // several tabs opened together, and the case worth sharing.
        if (
          message.namespace != null &&
          this.namespace != null &&
          message.namespace !== this.namespace
        ) {
          return;
        }
        // Only a question this tab is asking. Taking every answer would hold
        // every tab's queries in every tab's memory.
        const query = this.client
          .getQueryCache()
          .find({ queryKey: message.queryKey, exact: true });
        if (query == null || query.state.dataUpdatedAt >= message.updatedAt) {
          return;
        }
        this.received.set(message.hash, message.updatedAt);
        this.client.setQueryData(message.queryKey, message.data, {
          updatedAt: message.updatedAt,
        });
        return;
      }
      case 'session':
        // Another tab was told a different account by the same cookie, so the
        // cookie changed under this one. Writes stop, and the session query
        // asks again; its answer confirms, and the confirmation resets.
        if (this.namespace != null && message.namespace !== this.namespace) {
          this.suspend();
          void this.client.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
        }
        return;
      case 'signed-out':
        this.suspend();
        this.shown = undefined;
        this.resetAnswers(true);
        return;
      default:
        return;
    }
  }

  /**
   * Drops every answer this tab holds, and asks again for the ones on screen.
   * The session's own answer is kept unless the session itself ended.
   */
  resetAnswers(includeSession: boolean): void {
    this.received.clear();
    const affected = (queryKey: readonly unknown[]) =>
      includeSession || queryHash(queryKey) !== SESSION_HASH;
    const cache = this.client.getQueryCache();
    for (const query of cache.getAll()) {
      if (affected(query.queryKey) && query.getObserversCount() === 0) {
        cache.remove(query);
      }
    }
    void this.client.resetQueries({
      predicate: (query) => affected(query.queryKey),
    });
  }

  /**
   * Opens the store, throws out what may not be read, and places the rest. One
   * account is ever kept: the confirmed one if a confirmation beat the store
   * open, and otherwise the account of the newest record.
   */
  private async restore(
    openStore: () => Promise<CacheStore | undefined>
  ): Promise<void> {
    const store = await openStore().catch(() => undefined);
    if (store == null) return;
    this.store = store;
    let values: unknown[];
    try {
      values = await store.all();
    } catch {
      return;
    }
    const now = Date.now();
    const live: CacheRecord[] = [];
    const dead: string[] = [];
    for (const value of values) {
      if (isLiveRecord(value, now)) live.push(value);
      else if (hasId(value)) dead.push(value.id);
    }
    let newest: CacheRecord | undefined;
    for (const record of live) {
      if (newest == null || record.updatedAt > newest.updatedAt) {
        newest = record;
      }
    }
    const namespace = this.namespace ?? newest?.namespace;
    if (this.namespace == null) this.shown = namespace;
    for (const record of live) {
      if (record.namespace === namespace) this.place(record);
      else dead.push(record.id);
    }
    try {
      await store.remove(dead);
    } catch {
      // Left for the next load to throw out.
    }
  }

  /**
   * Puts a stored answer into the cache, unless this tab already holds a newer
   * one. An incomplete answer goes in as received at time zero, so React Query
   * counts it stale and fetches at once, and it is never borrowed.
   */
  private place(record: CacheRecord) {
    const state = this.client.getQueryState(record.queryKey);
    if (state?.data !== undefined && state.dataUpdatedAt >= record.updatedAt) {
      return;
    }
    if (record.complete) this.received.set(record.hash, record.updatedAt);
    this.client.setQueryData(record.queryKey, record.data, {
      updatedAt: record.complete ? record.updatedAt : 0,
    });
  }

  /** Deletes every other account's records, then writes what was waiting. */
  private async settleStore(namespace: string, pending: PendingRecord[]) {
    await this.ready;
    const store = this.store;
    if (store == null) return;
    try {
      const values = await store.all();
      const others: string[] = [];
      for (const value of values) {
        if (!hasId(value)) continue;
        const owner = (value as { namespace?: unknown }).namespace;
        if (owner !== namespace) others.push(value.id);
      }
      await store.remove(others);
    } catch {
      // The next confirmation tries again.
    }
    // A confirmation of another account may have landed while this waited, in
    // which case these answers are not this account's to file.
    if (this.namespace !== namespace) return;
    for (const record of pending) await this.write(namespace, record);
  }
}

function hasId(value: unknown): value is { id: string } {
  return (
    typeof value === 'object' &&
    value != null &&
    typeof (value as { id?: unknown }).id === 'string'
  );
}

/**
 * A name for this tab that no other tab shares. `crypto.randomUUID` exists only
 * in a secure context, and the plain-http deployment is one of the cases this
 * cache has to keep working in; `getRandomValues` exists in both.
 */
function tabName(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
}

/** The browser's own cache, built from whatever of the three it offers. */
export function createBrowserSharedCache(client: QueryClient): SharedCache {
  const tab = tabName();
  const bus = broadcastBus();
  const coordinator = pickCoordinator({
    secureContext: globalThis.isSecureContext === true,
    // Typed as always there, and absent in an insecure context and in an older
    // browser alike.
    locks: (navigator as { locks?: LockManager }).locks,
    bus,
    tab,
  });
  const cache = new SharedCache(client, {
    tab,
    coordinator,
    bus,
    openStore: openCacheStore,
  });

  // A tab that closes mid-fetch says so, or the tabs waiting on its lease wait
  // out the whole timeout. Web Locks needs no such word.
  const leave = () => coordinator.releaseAll();
  window.addEventListener('pagehide', leave);
  cache.adopt(() => window.removeEventListener('pagehide', leave));
  // A session the refresh could not mend ends in `authFetch`, outside any
  // hook, and everything the store holds for it has to go with it.
  cache.adopt(
    onSessionEnded(() => {
      void cache.endSession().then(() => cache.resetAnswers(true));
    })
  );
  return cache;
}
