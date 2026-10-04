import { QueryClient } from '@tanstack/react-query';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type Coordinator,
  softLeaseCoordinator,
  webLocksCoordinator,
} from './coordinator.ts';
import { withoutAttachments } from './persist.ts';
import {
  CACHE_SCHEMA_VERSION,
  type CacheRecord,
  queryHash,
  recordId,
} from './records.ts';
import { type Persist, SESSION_QUERY_KEY, SharedCache } from './sharedCache.ts';
import { busHub, memoryStore, settle, until } from './testing.ts';

const KEY = ['pulls.list', 'acme/app'];

function tab(
  name: string,
  hub: ReturnType<typeof busHub>,
  store: ReturnType<typeof memoryStore> | undefined,
  options: { lease?: boolean; confirmWaitMs?: number } = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const bus = hub.join();
  const base = options.lease
    ? softLeaseCoordinator(bus, { tab: name })
    : webLocksCoordinator(navigator.locks);
  // Counts the tab's turns at the coordinator, so a test can wait until this
  // tab is queued behind another before letting that one finish.
  let entered = 0;
  const coordinator: Coordinator = {
    kind: base.kind,
    exclusive: (key, task, signal) => {
      entered += 1;
      return base.exclusive(key, task, signal);
    },
    releaseAll: () => base.releaseAll(),
    dispose: () => base.dispose(),
  };
  const cache = new SharedCache(client, {
    tab: name,
    bus,
    coordinator,
    openStore: () => Promise.resolve(store),
    confirmWaitMs: options.confirmWaitMs,
  });
  /** Asks the way a mounted query asks: through React Query, through here. */
  const ask = <T>(
    fetch: () => Promise<T>,
    persist: Persist<T> = true,
    queryKey: readonly unknown[] = KEY
  ) =>
    client.fetchQuery({
      queryKey,
      queryFn: ({ signal }) =>
        cache.fetch({ queryKey, signal, fetch: () => fetch(), persist }),
      staleTime: 0,
    });
  return { client, cache, ask, entered: () => entered };
}

/** A promise the test resolves, for a fetch that must stay out until told. */
function gate() {
  let open = () => undefined as void;
  const closed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { closed, open };
}

function counter<T>(value: T, ms = 20) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    fetch: async () => {
      calls += 1;
      await settle(ms);
      return value;
    },
  };
}

function storedRecord(overrides: Partial<CacheRecord>): CacheRecord {
  const namespace = overrides.namespace ?? 'user:ada';
  const hash = queryHash(overrides.queryKey ?? KEY);
  return {
    id: recordId(namespace, hash),
    namespace,
    hash,
    queryKey: KEY,
    version: CACHE_SCHEMA_VERSION,
    updatedAt: Date.now() - 1_000,
    complete: true,
    data: { from: 'disk' },
    ...overrides,
  };
}

for (const lease of [false, true]) {
  const coordination = lease ? 'the soft lease' : 'Web Locks';

  describe(`two tabs asking at once, under ${coordination}`, () => {
    it('ask GitHub once and both get the answer', async () => {
      const hub = busHub();
      const store = memoryStore();
      const a = tab('a', hub, store, { lease });
      const b = tab('b', hub, store, { lease });
      let calls = 0;
      const held = gate();
      const fetch = async () => {
        calls += 1;
        await held.closed;
        return { pulls: ['one'] };
      };
      // The second tab asks while the first is out — after the first tab's
      // lease has had a task to reach it — and it is queued behind the first
      // tab's turn before that turn is allowed to end.
      const first = a.ask(fetch);
      await until(() => calls === 1);
      await settle(1);
      const second = b.ask(fetch);
      await until(() => b.entered() === 1);
      await settle(5);
      held.open();
      assert.deepEqual(await first, { pulls: ['one'] });
      assert.deepEqual(await second, { pulls: ['one'] });
      assert.equal(calls, 1);
    });
  });
}

describe('SharedCache', () => {
  it('asks again when the other answer is older than the window', async () => {
    const hub = busHub();
    const a = tab('a', hub, undefined);
    const b = tab('b', hub, undefined);
    const source = counter('answer', 1);
    // B already has the query, so it hears A's answer.
    b.client.setQueryData(KEY, 'old', { updatedAt: 1 });
    await a.ask(source.fetch);
    await settle();
    assert.equal(b.client.getQueryData(KEY), 'answer');
    await b.cache.fetch({
      queryKey: KEY,
      signal: new AbortController().signal,
      fetch: source.fetch,
      shareWindowMs: 0,
    });
    assert.equal(source.calls, 2);
  });

  it('asks GitHub after a forced reload, whatever another tab holds', async () => {
    const hub = busHub();
    const a = tab('a', hub, undefined);
    const b = tab('b', hub, undefined);
    const source = counter('answer', 1);
    b.client.setQueryData(KEY, 'old', { updatedAt: 1 });
    await a.ask(source.fetch);
    await settle();
    b.cache.forceNext(KEY);
    await b.ask(source.fetch);
    assert.equal(source.calls, 2);
  });

  it('never takes its own answer in place of a fetch', async () => {
    const a = tab('a', busHub(), undefined);
    const source = counter('answer', 1);
    await a.ask(source.fetch);
    await a.ask(source.fetch);
    assert.equal(source.calls, 2);
  });

  it('ignores an answer to a question this tab is not asking', async () => {
    const hub = busHub();
    const a = tab('a', hub, undefined);
    const b = tab('b', hub, undefined);
    await a.ask(() => Promise.resolve('answer'));
    await settle();
    assert.equal(b.client.getQueryCache().find({ queryKey: KEY }), undefined);
  });

  it('writes nothing to disk until the account is confirmed', async () => {
    const store = memoryStore();
    const a = tab('a', busHub(), store);
    // The order of a page load: the session is asked first, then the rest.
    await a.ask(() => Promise.resolve({ viewer: undefined }), false, [
      ...SESSION_QUERY_KEY,
    ]);
    await a.ask(() => Promise.resolve({ pulls: [] }));
    await settle();
    assert.equal(store.records.size, 0);
    a.cache.confirm('user:ada');
    await settle();
    const [only] = store.records.values();
    assert.equal(only?.namespace, 'user:ada');
    assert.deepEqual(only?.data, { pulls: [] });
  });

  it('never writes the session to disk', async () => {
    const store = memoryStore();
    const a = tab('a', busHub(), store);
    a.cache.confirm('user:ada');
    await a.ask(() => Promise.resolve({ viewer: { login: 'ada' } }), true, [
      ...SESSION_QUERY_KEY,
    ]);
    await settle();
    assert.equal(store.records.size, 0);
  });

  it('keeps signed addresses off the disk and marks the record partial', async () => {
    const store = memoryStore();
    const a = tab('a', busHub(), store);
    a.cache.confirm('user:ada');
    await a.ask(
      () =>
        Promise.resolve({
          title: 'Fix',
          attachments: { byId: { x: { url: 'signed' } } },
        }),
      withoutAttachments
    );
    await settle();
    const [only] = store.records.values();
    assert.deepEqual(only?.data, { title: 'Fix' });
    assert.equal(only?.complete, false);
    // The tab itself keeps the whole answer.
    assert.ok(
      (a.client.getQueryData(KEY) as { attachments?: unknown }).attachments
    );
  });

  it('keeps nothing when the persist function refuses the answer', async () => {
    const store = memoryStore();
    const a = tab('a', busHub(), store);
    a.cache.confirm('user:ada');
    await a.ask(
      () => Promise.resolve({ pulls: [], failures: ['rate limit'] }),
      (data) => (data.failures.length === 0 ? data : undefined)
    );
    await settle();
    assert.equal(store.records.size, 0);
  });

  it('counts an answer a persist function left alone as whole', async () => {
    const store = memoryStore();
    const a = tab('a', busHub(), store);
    a.cache.confirm('user:ada');
    await a.ask(() => Promise.resolve({ title: 'Fix' }), withoutAttachments);
    await settle();
    assert.equal([...store.records.values()][0]?.complete, true);
  });

  it('shows nothing from disk before the account is confirmed', async () => {
    const store = memoryStore();
    await store.put(storedRecord({}));
    const a = tab('a', busHub(), store);
    await settle();
    assert.equal(a.client.getQueryData(KEY), undefined);
  });

  it('draws a stored answer once confirmed and takes it in place of a fetch', async () => {
    const store = memoryStore();
    await store.put(storedRecord({}));
    const a = tab('a', busHub(), store);
    const source = counter({ from: 'github' }, 1);
    // The query asks before the session has answered, which is the order a
    // page load runs in: it waits for the confirmation, then takes the disk.
    const asked = a.ask(source.fetch);
    await settle();
    a.cache.confirm('user:ada');
    assert.deepEqual(await asked, { from: 'disk' });
    assert.equal(source.calls, 0);
  });

  it('fetches once the wait for a confirmation runs out', async () => {
    const store = memoryStore();
    await store.put(storedRecord({}));
    const a = tab('a', busHub(), store, { confirmWaitMs: 20 });
    const source = counter({ from: 'github' }, 1);
    assert.deepEqual(await a.ask(source.fetch), { from: 'github' });
    assert.equal(source.calls, 1);
  });

  it('never makes the session query wait', async () => {
    const store = memoryStore();
    await store.put(storedRecord({}));
    const a = tab('a', busHub(), store, { confirmWaitMs: 60_000 });
    const answer = await a.ask(
      () => Promise.resolve({ viewer: undefined }),
      false,
      [...SESSION_QUERY_KEY]
    );
    assert.deepEqual(answer, { viewer: undefined });
  });

  it('draws a partial answer once confirmed but fetches behind it', async () => {
    const store = memoryStore();
    await store.put(storedRecord({ complete: false }));
    const a = tab('a', busHub(), store);
    await settle();
    a.cache.confirm('user:ada');
    assert.deepEqual(a.client.getQueryData(KEY), { from: 'disk' });
    assert.equal(a.client.getQueryState(KEY)?.dataUpdatedAt, 0);
    const source = counter({ from: 'github' }, 1);
    assert.deepEqual(await a.ask(source.fetch), { from: 'github' });
    assert.equal(source.calls, 1);
  });

  it('throws out records an older build or a day ago wrote', async () => {
    const store = memoryStore();
    await store.put(storedRecord({ version: CACHE_SCHEMA_VERSION - 1 }));
    await store.put(storedRecord({ queryKey: ['stats.served'], updatedAt: 0 }));
    tab('a', busHub(), store);
    await settle();
    assert.equal(store.records.size, 0);
  });

  it('never shows and then forgets another account the session does not confirm', async () => {
    const store = memoryStore();
    await store.put(storedRecord({}));
    const a = tab('a', busHub(), store);
    await settle();
    a.cache.confirm('user:grace');
    await settle();
    assert.equal(a.client.getQueryData(KEY), undefined);
    assert.equal(store.records.size, 0);
  });

  it('keeps everything when the confirmed account is the stored one', async () => {
    const store = memoryStore();
    await store.put(storedRecord({}));
    const a = tab('a', busHub(), store);
    await settle();
    a.cache.confirm('user:ada');
    await settle();
    assert.equal(store.records.size, 1);
    assert.deepEqual(a.client.getQueryData(KEY), { from: 'disk' });
  });

  it('neither shares nor keeps an answer that crosses a change of account', async () => {
    const hub = busHub();
    const store = memoryStore();
    const a = tab('a', hub, store);
    a.cache.confirm('user:ada');
    await settle();
    const held = gate();
    const asked = a.ask(async () => {
      await held.closed;
      return { pulls: ['adas'] };
    });
    await settle();
    a.cache.confirm('user:grace');
    held.open();
    await asked.catch(() => undefined);
    await settle();
    assert.equal(store.records.size, 0);
    assert.equal(
      hub.sent.some((message) => message.type === 'data'),
      false
    );
  });

  it('neither shares nor keeps an answer that crosses a sign-out', async () => {
    const hub = busHub();
    const store = memoryStore();
    const a = tab('a', hub, store);
    a.cache.confirm('user:ada');
    await settle();
    const held = gate();
    const asked = a.ask(async () => {
      await held.closed;
      return { pulls: ['adas'] };
    });
    await settle();
    a.cache.suspend();
    held.open();
    await asked.catch(() => undefined);
    a.cache.confirm('anonymous');
    await settle();
    assert.equal(store.records.size, 0);
    assert.equal(
      hub.sent.some((message) => message.type === 'data'),
      false
    );
  });

  it('empties the store on sign-out and every tab stops writing', async () => {
    const hub = busHub();
    const store = memoryStore();
    const a = tab('a', hub, store);
    const b = tab('b', hub, store);
    a.cache.confirm('user:ada');
    b.cache.confirm('user:ada');
    await a.ask(() => Promise.resolve({ pulls: ['private'] }));
    await settle();
    assert.equal(store.records.size, 1);

    a.cache.suspend();
    await a.cache.endSession();
    await settle();
    assert.equal(store.records.size, 0);
    // B heard it: an answer that lands now waits for a confirmation rather
    // than going under the account that left.
    await b.ask(() => Promise.resolve({ pulls: ['late'] }), true, [
      'pulls.list',
      'acme/other',
    ]);
    await settle();
    assert.equal(store.records.size, 0);
    assert.ok(
      hub.sent.some((message) => message.type === 'signed-out'),
      'the sign-out was announced'
    );
  });

  it('makes a tab ask who it is when another tab was told someone else', async () => {
    const hub = busHub();
    const a = tab('a', hub, undefined);
    const b = tab('b', hub, undefined);
    const session = [...SESSION_QUERY_KEY];
    b.client.setQueryData(session, { viewer: undefined });
    b.client.setQueryData(KEY, { pulls: ['anonymous'] });
    b.cache.confirm('anonymous');
    a.cache.confirm('user:ada');
    await settle();
    // Every answer goes, the session's own included, so a session query that
    // then fails leaves nothing of the old account on screen.
    assert.equal(b.client.getQueryData(session), undefined);
    assert.equal(b.client.getQueryData(KEY), undefined);
  });

  it('makes an unconfirmed tab ask again when another tab confirms', async () => {
    const hub = busHub();
    const a = tab('a', hub, undefined);
    const b = tab('b', hub, undefined);
    const session = [...SESSION_QUERY_KEY];
    b.client.setQueryData(session, { viewer: undefined });
    a.cache.confirm('user:ada');
    await settle();
    assert.equal(b.client.getQueryState(session)?.isInvalidated, true);
  });

  it('never borrows, broadcasts or stores the session', async () => {
    const hub = busHub();
    const store = memoryStore();
    const a = tab('a', hub, store);
    const b = tab('b', hub, store);
    const session = [...SESSION_QUERY_KEY];
    let asked = 0;
    const who = () => {
      asked += 1;
      return Promise.resolve({ viewer: { login: 'ada' } });
    };
    const first = a.ask(who, true, session);
    const second = b.ask(who, true, session);
    await Promise.all([first, second]);
    await settle();
    assert.equal(asked, 2);
    assert.equal(
      hub.sent.some((message) => message.type === 'data'),
      false
    );
    assert.equal(store.records.size, 0);
  });

  it('asks again for an answer that began before the confirming session', async () => {
    const store = memoryStore();
    const a = tab('a', busHub(), store);
    const held = gate();
    let calls = 0;
    const asked = a.ask(async () => {
      calls += 1;
      if (calls === 1) await held.closed;
      return { pulls: [`answer ${calls}`] };
    });
    await settle();
    // The session is asked after that fetch began, and confirms an account.
    await a.ask(() => Promise.resolve({ viewer: undefined }), false, [
      ...SESSION_QUERY_KEY,
    ]);
    a.cache.confirm('user:grace');
    held.open();
    assert.deepEqual(await asked, { pulls: ['answer 2'] });
    assert.equal(calls, 2);
    await settle();
    assert.deepEqual([...store.records.values()][0]?.data, {
      pulls: ['answer 2'],
    });
  });

  it('publishes nothing for a write sent under an older session', async () => {
    const hub = busHub();
    const store = memoryStore();
    const a = tab('a', hub, store);
    a.cache.confirm('user:ada');
    const ticket = a.cache.ticket();
    a.cache.suspend();
    a.cache.confirm('anonymous');
    a.cache.publish(KEY, { review: 'APPROVED' }, true, ticket);
    await settle();
    assert.equal(a.client.getQueryData(KEY), undefined);
    assert.equal(store.records.size, 0);
    assert.equal(
      hub.sent.some((message) => message.type === 'data'),
      false
    );
  });

  it('never lands an older read on top of a newer write', async () => {
    const store = memoryStore();
    const a = tab('a', busHub(), store);
    a.cache.confirm('user:ada');
    const held = gate();
    const asked = a.ask(async () => {
      await held.closed;
      return { review: 'COMMENTED' };
    });
    await settle();
    a.cache.publish(KEY, { review: 'APPROVED' }, true, a.cache.ticket());
    await settle(2);
    held.open();
    assert.deepEqual(await asked, { review: 'APPROVED' });
    await settle();
    assert.deepEqual([...store.records.values()][0]?.data, {
      review: 'APPROVED',
    });
  });

  it('refuses an answer fetched under an account this tab does not share', async () => {
    // A message that left before a change of account, arriving after it: the
    // sender's session message is long gone, and only the namespace on the
    // answer itself can say it is not this account's.
    const hub = busHub();
    const late = hub.join();
    const b = tab('b', hub, undefined);
    b.cache.confirm('user:ada');
    b.client.setQueryData(KEY, 'mine', { updatedAt: 1 });
    late.post({
      type: 'data',
      tab: 'a',
      namespace: 'user:grace',
      hash: queryHash(KEY),
      queryKey: KEY,
      data: 'graces',
      updatedAt: Date.now(),
    });
    await settle();
    assert.equal(b.client.getQueryData(KEY), 'mine');
  });

  it('takes an answer from a tab that has not confirmed yet', async () => {
    const hub = busHub();
    const early = hub.join();
    const b = tab('b', hub, undefined);
    b.cache.confirm('user:ada');
    b.client.setQueryData(KEY, 'mine', { updatedAt: 1 });
    early.post({
      type: 'data',
      tab: 'a',
      hash: queryHash(KEY),
      queryKey: KEY,
      data: 'shared',
      updatedAt: Date.now(),
    });
    await settle();
    assert.equal(b.client.getQueryData(KEY), 'shared');
  });

  it('finds the record the tab before it wrote, when the message is slow', async () => {
    // A store and a lock shared by two tabs, and a channel that delivers
    // nothing: the waiting tab must find the answer on disk.
    const store = memoryStore();
    const silent = { join: () => busHub().join(), sent: [] };
    const a = tab('a', silent as ReturnType<typeof busHub>, store);
    const b = tab('b', silent as ReturnType<typeof busHub>, store);
    a.cache.confirm('user:ada');
    b.cache.confirm('user:ada');
    let calls = 0;
    const held = gate();
    const fetch = async () => {
      calls += 1;
      await held.closed;
      return { pulls: ['one'] };
    };
    const first = a.ask(fetch);
    await until(() => calls === 1);
    const second = b.ask(fetch);
    await until(() => b.entered() === 1);
    await settle(5);
    held.open();
    await Promise.all([first, second]);
    assert.equal(calls, 1);
  });

  it('carries a published write to every tab and to disk', async () => {
    const hub = busHub();
    const store = memoryStore();
    const a = tab('a', hub, store);
    const b = tab('b', hub, store);
    a.cache.confirm('user:ada');
    const key = ['viewedFiles.list', 'acme', 'app', 1];
    b.client.setQueryData(key, { paths: [] }, { updatedAt: 1 });
    a.cache.publish(key, { paths: ['a.ts'] }, true);
    await settle();
    assert.deepEqual(b.client.getQueryData(key), { paths: ['a.ts'] });
    assert.equal(store.records.size, 1);
  });
});
