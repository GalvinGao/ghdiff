// Which tab asks GitHub, when several of them want the same answer.
//
// The coordinator only decides who goes first. What the tab that goes second
// does with that — take the answer the first one broadcast, or fetch after all —
// is `SharedCache`'s, and it never trusts the coordinator for correctness: a
// coordinator that let two tabs through at once costs a request, never a wrong
// answer. That is what lets the weaker two below exist at all.

import type { CacheMessage, MessageBus } from './messages.ts';

export type CoordinatorKind = 'web-locks' | 'soft-lease' | 'local';

export interface Coordinator {
  readonly kind: CoordinatorKind;
  /**
   * Runs `task` once no other tab of this browser is running one for `key`.
   * `signal` abandons the wait. The task is told whether it had to wait,
   * because a task that waited may find the answer it was about to fetch has
   * just been fetched by the tab it waited on.
   */
  exclusive<T>(
    key: string,
    task: (contended: boolean) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T>;
  /** Lets go of everything this tab holds, for a tab about to close. */
  releaseAll(): void;
  dispose(): void;
}

/**
 * The exact one. The browser queues every request for a name and grants them in
 * turn across tabs, and it frees a lock whose tab closed or crashed, so no tab
 * can be left waiting on one that is gone.
 *
 * It needs a secure context: `navigator.locks` does not exist on a plain-http
 * address other than localhost, which is where a self-hosted deployment on a
 * LAN finds itself.
 */
export function webLocksCoordinator(locks: LockManager): Coordinator {
  return {
    kind: 'web-locks',
    async exclusive<T>(
      key: string,
      task: (contended: boolean) => Promise<T>,
      signal?: AbortSignal
    ): Promise<T> {
      const name = `ghdiff-cache:${key}`;
      // Asked first without waiting, which is the only way the API says
      // whether somebody else holds the lock. `signal` cannot go with
      // `ifAvailable`, and a request that never waits has no use for one.
      let granted = false;
      let value: T | undefined;
      await locks.request(name, { ifAvailable: true }, async (lock) => {
        if (lock == null) return;
        granted = true;
        value = await task(false);
      });
      if (granted) return value as T;
      return await locks.request(name, signal == null ? {} : { signal }, () =>
        task(true)
      );
    },
    releaseAll: () => undefined,
    dispose: () => undefined,
  };
}

/** How long a tab waits on another one's lease before it fetches anyway. */
export const LEASE_WAIT_MS = 10_000;

/**
 * The best effort, for a browser with a channel and no locks. A tab announces a
 * fetch before it starts and again when it ends, and a tab that hears the first
 * waits for the second. Two tabs that announce in the same moment both fetch,
 * and a tab that vanishes without a word is waited on for `LEASE_WAIT_MS` at
 * most — both of which cost a request and nothing else.
 *
 * A lease record in IndexedDB was the exact alternative, since a read-write
 * transaction serializes across tabs. It loses on what a crashed tab leaves
 * behind: a lease nobody releases needs an expiry and a renewal timer, and that
 * is a lot of machinery for the few browsers that reach this path.
 */
export function softLeaseCoordinator(
  bus: MessageBus,
  options: { tab: string; waitMs?: number; now?: () => number }
): Coordinator {
  const { tab } = options;
  const waitMs = options.waitMs ?? LEASE_WAIT_MS;
  const now = options.now ?? Date.now;
  /** Leases other tabs announced, by key: whose, and until when. */
  const held = new Map<string, { tab: string; until: number }>();
  /** Who is waiting on each key, woken by its release. */
  const waiters = new Map<string, Set<() => void>>();
  const own = new Set<string>();

  const wake = (key: string) => {
    const list = waiters.get(key);
    if (list == null) return;
    waiters.delete(key);
    for (const resolve of list) resolve();
  };

  const unsubscribe = bus.subscribe((message: CacheMessage) => {
    if (message.type === 'lease') {
      held.set(message.key, { tab: message.tab, until: now() + waitMs });
    } else if (message.type === 'release') {
      if (held.get(message.key)?.tab === message.tab) held.delete(message.key);
      wake(message.key);
    }
  });

  /** Resolves on the release, on the timeout, or rejects on the abort. */
  const waitFor = (key: string, ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
        waiters.get(key)?.delete(done);
        resolve();
      };
      const aborted = () => {
        clearTimeout(timer);
        waiters.get(key)?.delete(done);
        reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(done, ms);
      signal?.addEventListener('abort', aborted, { once: true });
      const list = waiters.get(key) ?? new Set();
      list.add(done);
      waiters.set(key, list);
    });

  return {
    kind: 'soft-lease',
    async exclusive(key, task, signal) {
      let contended = false;
      for (;;) {
        signal?.throwIfAborted();
        const lease = held.get(key);
        if (lease == null) break;
        const left = lease.until - now();
        if (left <= 0) {
          held.delete(key);
          break;
        }
        contended = true;
        await waitFor(key, left, signal);
      }
      own.add(key);
      bus.post({ type: 'lease', key, tab });
      try {
        return await task(contended);
      } finally {
        own.delete(key);
        bus.post({ type: 'release', key, tab });
      }
    },
    releaseAll() {
      for (const key of own) bus.post({ type: 'release', key, tab });
      own.clear();
    },
    dispose() {
      unsubscribe();
      for (const key of [...waiters.keys()]) wake(key);
    },
  };
}

/** No other tab can be heard, so there is nobody to take turns with. */
export function localCoordinator(): Coordinator {
  return {
    kind: 'local',
    exclusive: (_key, task) => task(false),
    releaseAll: () => undefined,
    dispose: () => undefined,
  };
}

/**
 * The strongest coordinator this browser offers. Web Locks needs a secure
 * context as well as the API, and a browser with neither locks nor a channel
 * gets each tab on its own — which is what every tab was before any of this.
 */
export function pickCoordinator(options: {
  secureContext: boolean;
  locks?: LockManager;
  bus?: MessageBus;
  tab: string;
}): Coordinator {
  const { bus, locks, secureContext, tab } = options;
  if (secureContext && locks != null && typeof locks.request === 'function') {
    return webLocksCoordinator(locks);
  }
  if (bus != null) return softLeaseCoordinator(bus, { tab });
  return localCoordinator();
}
