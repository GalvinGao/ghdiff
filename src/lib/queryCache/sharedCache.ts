// One cache for every tab of the browser, over React Query.
//
// Three parts, and each one degrades on its own. The coordinator decides which
// tab fetches a key when several want it; the channel carries the answer to
// the others the moment it lands; the store keeps it for the next load. A
// browser with none of the three is a tab with an in-memory cache of its own,
// which is what every tab had before this file existed.
//
// The one rule all of it holds to: an answer is never wrong because another tab
// provided it. Nothing leaves a tab or reaches it before the session has said
// whose cookie this is, everything is filed under that account, and answers are
// ordered by when their fetch began. A tab takes another's answer only when it
// is younger than the query's share window and arrived without this tab asking.

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
  moment,
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

/**
 * How long a request waits for the session to say whose cookie this is. The
 * session query is a request to this Worker and is usually back in a few
 * hundred milliseconds; past this a request goes ahead unvouched, and nothing
 * it brings back is kept.
 */
const CONFIRM_WAIT_MS = 3_000;

/** How many times a request is asked again because the session changed under
    it, before it gives up rather than hand back an answer nobody vouches for. */
const SESSION_ATTEMPTS = 3;

export interface SharedCacheEnvironment {
  tab: string;
  coordinator: Coordinator;
  bus?: MessageBus;
  openStore(): Promise<CacheStore | undefined>;
  /** `CONFIRM_WAIT_MS`, unless a test needs a shorter wait. */
  confirmWaitMs?: number;
}

export class SharedCache {
  readonly tab: string;
  readonly coordinator: Coordinator;
  private readonly client: QueryClient;
  private readonly bus?: MessageBus;
  private store?: CacheStore;
  /** Settles once the store is open and its records are read. */
  private readonly ready: Promise<void>;
  /** The account this tab has confirmed, or nothing while it has not. */
  private namespace?: string;
  /**
   * The account this tab last confirmed, kept through a suspension. A
   * confirmation that differs from it is a change of account, and resets every
   * answer.
   */
  private shown?: string;
  /**
   * The records the store held at startup, read and not yet shown. Nothing on
   * disk reaches the screen before the session says whose it is: a stored
   * answer belongs to the account that fetched it, and the cookie may belong
   * to somebody else by now.
   */
  private held: CacheRecord[] = [];
  /** Settles at the next confirmation, for the queries waiting on `held`. */
  private confirmation = deferred();
  private readonly confirmWaitMs: number;
  /**
   * Raised by every suspension and every change of account. A fetch notes it
   * as it starts, and an answer that lands under a later one is the previous
   * session's: it is handed back to React Query, which drops it if the reset
   * cancelled its query, and it is never broadcast or written down.
   */
  private generation = 0;
  /**
   * When the session fetch began whose answer the current confirmation rests
   * on. An answer says whose cookie it was at the moment it was asked, so it
   * vouches for every fetch that began after it and for none that began
   * before: the cookie may have changed hands in between, and nothing would
   * have said so.
   */
  private sessionStartedAt?: number;
  private confirmedFrom = 0;
  /**
   * When the fetch began whose answer this tab holds for each query, by hash:
   * its own fetch, another tab's broadcast, or the moment of a write it
   * published. Answers are ordered by this and never by when they landed — a
   * read that began before a write can land after it, and must not win.
   */
  private readonly heldFrom = new Map<string, number>();
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
    this.confirmWaitMs = environment.confirmWaitMs ?? CONFIRM_WAIT_MS;
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
    // The session query asks with this tab's own cookie and nothing else:
    // another tab's answer to "who is this" may predate a sign-in that this
    // document is the result of. It is never borrowed, broadcast or stored,
    // and an answer asked across a change of session is asked again, since a
    // query already in flight is one React Query would hand back as it is.
    if (hash === SESSION_HASH) {
      this.forced.delete(hash);
      for (let attempt = 0; attempt < SESSION_ATTEMPTS; attempt += 1) {
        const generation = this.generation;
        const startedAt = moment();
        const data = await fetch(signal);
        if (generation === this.generation) {
          this.sessionStartedAt = startedAt;
          return data;
        }
      }
      throw new Error('The session kept changing while this tab asked.');
    }
    await this.awaitConfirmation(signal);
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
        // A fetch that began before the session answer the tab has since
        // confirmed is asked again under that session; so is one that began
        // before a change of session, which React Query may not have
        // cancelled. What comes back unvouched after that is handed back and
        // kept out of every other tab and off the disk.
        for (let attempt = 0; ; attempt += 1) {
          const generation = this.generation;
          const startedAt = moment();
          const data = await fetch(signal);
          // Asked again only when the session moved under it — a change, or a
          // confirmation that came after it began. A tab still waiting on its
          // first confirmation hands the answer back unshared, since asking
          // again would only ask under the same unknown session.
          const moved =
            generation !== this.generation ||
            (this.namespace != null && startedAt < this.confirmedFrom);
          if (moved) {
            // A reset cancelled the query: React Query drops the answer.
            if (signal.aborted || attempt + 1 >= SESSION_ATTEMPTS) {
              this.hold(hash, startedAt);
              return data;
            }
            await this.awaitConfirmation(signal);
            continue;
          }
          if (this.namespace == null) {
            this.hold(hash, startedAt);
            return data;
          }
          // A newer answer reached this tab while this one was out — a write
          // it published, or a fetch another tab began later — and an older
          // answer must not land on top of it.
          const newer = this.newerThan<T>(queryKey, hash, startedAt);
          if (newer !== undefined) return newer;
          // Written before the lock is let go, so a tab that waited on it finds
          // the record when its turn comes, whatever the channel has delivered.
          await this.share(
            queryKey,
            hash,
            data,
            Date.now(),
            persist,
            startedAt
          );
          // And asked once more after the write, which takes time of its own.
          const later = this.newerThan<T>(queryKey, hash, startedAt);
          if (later !== undefined) return later;
          this.hold(hash, startedAt);
          return data;
        }
      },
      signal
    );
  }

  /** Notes when the fetch began whose answer this tab now holds. */
  private hold(hash: string, startedAt: number) {
    this.heldFrom.set(hash, startedAt);
  }

  /** The answer this tab holds, when its fetch began after `startedAt`. */
  private newerThan<T>(
    queryKey: readonly unknown[],
    hash: string,
    startedAt: number
  ): T | undefined {
    const from = this.heldFrom.get(hash);
    if (from == null || from <= startedAt) return undefined;
    return this.client.getQueryState<T>(queryKey)?.data;
  }

  /**
   * The session as it stands, for a write to hand back to `publish` when it
   * lands. A write is a request like any other, and its answer belongs to the
   * session it was sent under.
   */
  ticket(): number {
    return this.generation;
  }

  /**
   * Waits for the session to confirm an account, so that every request starts
   * under a session somebody has vouched for. React runs a child's effects
   * before its parent's, so the review screen's queries start before the
   * session query above them, and without the wait each of them would be
   * unvouched and asked again. It is also what lets a stored answer stand in
   * for a request at all: the store is read only for the confirmed account.
   * The session query never waits, since it is the one that confirms, and a
   * wait that runs out lets the request go ahead unvouched.
   */
  private async awaitConfirmation(signal?: AbortSignal) {
    if (this.namespace != null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const aborted = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.confirmWaitMs);
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    await Promise.race([this.confirmation.promise, aborted]);
    clearTimeout(timer);
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
  publish<T>(
    queryKey: readonly unknown[],
    data: T,
    persist: Persist<T>,
    ticket?: number
  ) {
    // Sent under a session that has since ended or changed hands.
    if (ticket != null && ticket !== this.generation) return;
    const hash = queryHash(queryKey);
    const startedAt = moment();
    this.client.setQueryData(queryKey, data);
    this.hold(hash, startedAt);
    void this.share(queryKey, hash, data, Date.now(), persist, startedAt);
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
    this.confirmedFrom = this.sessionStartedAt ?? moment();
    if (previous != null && previous !== namespace) {
      this.generation += 1;
      this.resetAnswers(false);
    } else {
      // The same account, or the first one: what this tab already holds stays,
      // except an answer whose fetch began before the confirming session fetch
      // did. Nothing vouches for that one, so it is dropped and asked again.
      const unvouched = new Set<string>();
      for (const [hash, from] of this.heldFrom) {
        if (from < this.confirmedFrom) unvouched.add(hash);
      }
      if (unvouched.size > 0) {
        for (const hash of unvouched) {
          this.heldFrom.delete(hash);
          this.received.delete(hash);
        }
        void this.client.resetQueries({
          predicate: (query) => unvouched.has(queryHash(query.queryKey)),
        });
      }
    }
    // What the store held at startup reaches the screen now, and only the part
    // that is this account's. The rest is deleted by `settleStore`.
    const held = this.held;
    this.held = [];
    for (const record of held) {
      if (record.namespace === namespace) this.place(record);
    }
    this.confirmation.resolve();
    this.confirmation = deferred();
    void this.settleStore(namespace);
    this.bus?.post({ type: 'session', tab: this.tab, namespace });
  }

  /**
   * Stops every write to the store until the next confirmation. Called the
   * moment a sign-out starts, so an answer that lands while the session is
   * ending is not filed under the account that is leaving.
   */
  suspend(): void {
    this.namespace = undefined;
    this.generation += 1;
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
    this.held = [];
    this.received.clear();
    this.heldFrom.clear();
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
    persist: Persist<T>,
    startedAt: number
  ): Promise<void> {
    // Nothing leaves this tab, to the others or to the disk, before the session
    // has said whose cookie it is.
    const namespace = this.namespace;
    if (namespace == null) return;
    this.received.delete(hash);
    this.bus?.post({
      type: 'data',
      tab: this.tab,
      namespace,
      hash,
      queryKey: [...queryKey],
      data,
      updatedAt,
      startedAt,
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
    await this.write(namespace, record);
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
        // Never the session's answer: see `fetch`.
        if (message.hash === SESSION_HASH) return;
        // Only an answer the sender's session vouched for, under the account
        // this tab has confirmed too. A tab shares nothing before its own
        // confirmation, and takes nothing before its own either.
        if (this.namespace == null || message.namespace !== this.namespace) {
          return;
        }
        // Only a question this tab is asking. Taking every answer would hold
        // every tab's queries in every tab's memory.
        const query = this.client
          .getQueryCache()
          .find({ queryKey: message.queryKey, exact: true });
        if (query == null) return;
        // Ordered by when the fetch began, so an answer that began before the
        // one this tab holds is older however late it arrives.
        const startedAt = message.startedAt ?? message.updatedAt;
        const from = this.heldFrom.get(message.hash);
        if (from != null && from >= startedAt) return;
        this.hold(message.hash, startedAt);
        this.received.set(message.hash, message.updatedAt);
        this.client.setQueryData(message.queryKey, message.data, {
          updatedAt: message.updatedAt,
        });
        return;
      }
      case 'session':
        // Another tab was told a different account by the same cookie, so the
        // cookie changed under this one. Writes stop and every answer goes,
        // the session's own included, so a session query that then fails
        // leaves nothing of the old account on screen.
        if (this.namespace != null && message.namespace !== this.namespace) {
          this.suspend();
          this.shown = undefined;
          this.resetAnswers(true);
          return;
        }
        // A tab that has not confirmed yet cannot tell, so it takes the news
        // as a possible change: what it is fetching now is not vouched for,
        // and the session query asks again.
        if (this.namespace == null) {
          this.generation += 1;
          void this.client.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
        }
        return;
      case 'signed-out':
        this.suspend();
        this.shown = undefined;
        this.held = [];
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
    this.heldFrom.clear();
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
   * Opens the store, throws out what may not be read, and keeps the rest until
   * the session confirms whose they are — or places them at once, when a
   * confirmation beat the store open. One account is ever kept: the confirmed
   * one, or until then the account of the newest record.
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
    const confirmed = this.namespace;
    const namespace = confirmed ?? newest?.namespace;
    const kept: CacheRecord[] = [];
    for (const record of live) {
      if (record.namespace !== namespace) dead.push(record.id);
      else if (confirmed != null) this.place(record);
      else kept.push(record);
    }
    this.held = kept;
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
    // Vouched for by its account, and older than anything fetched now.
    this.hold(record.hash, 0);
    this.client.setQueryData(record.queryKey, record.data, {
      updatedAt: record.complete ? record.updatedAt : 0,
    });
  }

  /** Deletes every other account's records. */
  private async settleStore(namespace: string) {
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
  }
}

/** A promise with its resolver beside it. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => undefined as void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
