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
  moment,
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
  options: { lease?: boolean; confirmWaitMs?: number; account?: string } = {}
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
    // Short, so a test that never confirms is not held up by the wait.
    confirmWaitMs: options.confirmWaitMs ?? 30,
  });
  // A tab that shares anything has a confirmed account: nothing leaves an
  // unconfirmed tab, and nothing reaches one.
  if (options.account != null) cache.confirm(options.account);
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
      const a = tab('a', hub, store, { lease, account: 'user:ada' });
      const b = tab('b', hub, store, { lease, account: 'user:ada' });
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
    const a = tab('a', hub, undefined, { account: 'user:ada' });
    const b = tab('b', hub, undefined, { account: 'user:ada' });
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
    const a = tab('a', hub, undefined, { account: 'user:ada' });
    const b = tab('b', hub, undefined, { account: 'user:ada' });
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

  it('keeps nothing fetched before the account is confirmed', async () => {
    const store = memoryStore();
    const hub = busHub();
    const a = tab('a', hub, store);
    await a.ask(() => Promise.resolve({ pulls: [] }));
    a.cache.confirm('user:ada');
    await settle();
    assert.equal(store.records.size, 0);
    assert.equal(
      hub.sent.some((message) => message.type === 'data'),
      false
    );
  });

  it('waits for the confirmation before it asks, and keeps what it gets', async () => {
    const store = memoryStore();
    const a = tab('a', busHub(), store, { confirmWaitMs: 60_000 });
    const asked = a.ask(() => Promise.resolve({ pulls: ['after'] }));
    await settle();
    a.cache.confirm('user:ada');
    await asked;
    await settle();
    assert.equal([...store.records.values()][0]?.namespace, 'user:ada');
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
    const a = tab('a', busHub(), store, { confirmWaitMs: 1 });
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

  it('takes another tab’s answer for the same account, ordered by its start', async () => {
    const hub = busHub();
    const other = hub.join();
    const b = tab('b', hub, undefined, { account: 'user:ada' });
    b.client.setQueryData(KEY, 'mine', { updatedAt: 1 });
    const message = (data: string, startedAt: number) => ({
      type: 'data' as const,
      tab: 'a',
      namespace: 'user:ada',
      hash: queryHash(KEY),
      queryKey: KEY,
      data,
      updatedAt: Date.now(),
      startedAt,
    });
    const earlier = moment();
    const later = moment();
    other.post(message('later', later));
    await settle();
    assert.equal(b.client.getQueryData(KEY), 'later');
    // Began before the answer held, so it is older however late it lands.
    other.post(message('earlier', earlier));
    await settle();
    assert.equal(b.client.getQueryData(KEY), 'later');
  });

  it('takes nothing from another tab before its own confirmation', async () => {
    const hub = busHub();
    const other = hub.join();
    const b = tab('b', hub, undefined);
    b.client.setQueryData(KEY, 'mine', { updatedAt: 1 });
    other.post({
      type: 'data',
      tab: 'a',
      namespace: 'user:ada',
      hash: queryHash(KEY),
      queryKey: KEY,
      data: 'shared',
      updatedAt: Date.now(),
      startedAt: moment(),
    });
    await settle();
    assert.equal(b.client.getQueryData(KEY), 'mine');
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

  it('asks who it is again when the session changes during the asking', async () => {
    const a = tab('a', busHub(), undefined);
    const session = [...SESSION_QUERY_KEY];
    const held = gate();
    let asked = 0;
    const answer = a.ask(
      async () => {
        asked += 1;
        if (asked === 1) {
          await held.closed;
          return { viewer: { login: 'ada' } };
        }
        return { viewer: { login: 'grace' } };
      },
      false,
      session
    );
    await settle();
    a.cache.suspend();
    held.open();
    assert.deepEqual(await answer, { viewer: { login: 'grace' } });
    assert.equal(asked, 2);
  });

  it('never lands an older read on a write published during its disk write', async () => {
    const memory = memoryStore();
    const writing = gate();
    let puts = 0;
    const slow = {
      ...memory,
      put: async (record: CacheRecord) => {
        puts += 1;
        if (puts === 1) await writing.closed;
        return memory.put(record);
      },
    };
    const a = tab('a', busHub(), slow as typeof memory, {
      account: 'user:ada',
    });
    const asked = a.ask(() => Promise.resolve({ review: 'COMMENTED' }));
    await until(() => puts === 1);
    a.cache.publish(KEY, { review: 'APPROVED' }, true, a.cache.ticket());
    writing.open();
    assert.deepEqual(await asked, { review: 'APPROVED' });
  });

  it('drops an answer held from before the first confirmation', async () => {
    const a = tab('a', busHub(), undefined, { confirmWaitMs: 1 });
    // The wait runs out and the answer lands unvouched.
    await a.ask(() => Promise.resolve({ pulls: ['unvouched'] }));
    await a.ask(() => Promise.resolve({ viewer: undefined }), false, [
      ...SESSION_QUERY_KEY,
    ]);
    a.cache.confirm('user:grace');
    await settle();
    assert.equal(a.client.getQueryData(KEY), undefined);
  });

  it('never lets a cancelled read lower a newer answer’s start', async () => {
    const hub = busHub();
    const other = hub.join();
    const a = tab('a', hub, undefined, { account: 'user:ada' });
    const held = gate();
    const asked = a.ask(async () => {
      await held.closed;
      return { review: 'adas' };
    });
    await settle();
    a.cache.confirm('user:grace');
    const between = moment();
    a.cache.publish(KEY, { review: 'APPROVED' }, true, a.cache.ticket());
    held.open();
    await asked.catch(() => undefined);
    // Began after Ada's cancelled read and before the approval.
    other.post({
      type: 'data',
      tab: 'b',
      namespace: 'user:grace',
      hash: queryHash(KEY),
      queryKey: KEY,
      data: { review: 'COMMENTED' },
      updatedAt: Date.now(),
      startedAt: between,
    });
    await settle();
    assert.deepEqual(a.client.getQueryData(KEY), { review: 'APPROVED' });
  });

  it('keeps the later-begun answer on disk, whichever tab writes last', async () => {
    // Two channels, so B never hears A's approval and only the store's own
    // rule can keep B's older read from overwriting it.
    const store = memoryStore();
    const a = tab('a', busHub(), store, { account: 'user:ada' });
    const b = tab('b', busHub(), store, { account: 'user:ada', lease: true });
    let puts = 0;
    const counted = store.put;
    store.put = (record) => {
      puts += 1;
      return counted(record);
    };
    const held = gate();
    const read = b.ask(async () => {
      await held.closed;
      return { review: 'COMMENTED' };
    });
    await settle();
    a.cache.publish(KEY, { review: 'APPROVED' }, true, a.cache.ticket());
    await settle();
    held.open();
    await read;
    await settle();
    assert.equal(puts, 2, 'the older read did try to write');
    assert.deepEqual([...store.records.values()][0]?.data, {
      review: 'APPROVED',
    });
  });

  it('keeps a restored answer ahead of an older broadcast', async () => {
    const hub = busHub();
    const other = hub.join();
    const store = memoryStore();
    const earlier = moment();
    const later = moment();
    await store.put(
      storedRecord({ data: { review: 'APPROVED' }, startedAt: later })
    );
    const b = tab('b', hub, store);
    await settle();
    b.cache.confirm('user:ada');
    assert.deepEqual(b.client.getQueryData(KEY), { review: 'APPROVED' });
    other.post({
      type: 'data',
      tab: 'a',
      namespace: 'user:ada',
      hash: queryHash(KEY),
      queryKey: KEY,
      data: { review: 'COMMENTED' },
      updatedAt: Date.now(),
      startedAt: earlier,
    });
    await settle();
    assert.deepEqual(b.client.getQueryData(KEY), { review: 'APPROVED' });
  });

  it('keeps an answer read from the store ahead of an older broadcast', async () => {
    const hub = busHub();
    const other = hub.join();
    const store = memoryStore();
    const a = tab('a', busHub(), store, { account: 'user:ada' });
    const b = tab('b', hub, store, { account: 'user:ada' });
    const earlier = moment();
    // A holds the lock and writes the record; B waits, then reads it.
    const held = gate();
    const first = a.ask(async () => {
      await held.closed;
      return { review: 'APPROVED' };
    });
    await settle();
    const second = b.ask(() => Promise.resolve({ review: 'unused' }));
    await until(() => b.entered() === 1);
    held.open();
    await first;
    assert.deepEqual(await second, { review: 'APPROVED' });
    other.post({
      type: 'data',
      tab: 'c',
      namespace: 'user:ada',
      hash: queryHash(KEY),
      queryKey: KEY,
      data: { review: 'COMMENTED' },
      updatedAt: Date.now(),
      startedAt: earlier,
    });
    await settle();
    assert.deepEqual(b.client.getQueryData(KEY), { review: 'APPROVED' });
  });

  it('carries a published write to every tab and to disk', async () => {
    const hub = busHub();
    const store = memoryStore();
    const a = tab('a', hub, store);
    const b = tab('b', hub, store, { account: 'user:ada' });
    a.cache.confirm('user:ada');
    const key = ['viewedFiles.list', 'acme', 'app', 1];
    b.client.setQueryData(key, { paths: [] }, { updatedAt: 1 });
    a.cache.publish(key, { paths: ['a.ts'] }, true);
    await settle();
    assert.deepEqual(b.client.getQueryData(key), { paths: ['a.ts'] });
    assert.equal(store.records.size, 1);
  });
});

describe('SharedCache.fetchText', () => {
  const KEY_TEXT = ['diff', 'github-pull:acme/app#1'];

  /** A source that answers 304 to the ETag it last gave, and counts asks. */
  function source(text: string, etag = 'W/"1"') {
    const asks: (string | undefined)[] = [];
    return {
      asks,
      fetch: async (sent: string | undefined) => {
        asks.push(sent);
        await settle(5);
        return sent === etag
          ? ({ status: 'unchanged' } as const)
          : ({ status: 'fresh', text, etag } as const);
      },
    };
  }

  it('keeps a patch and asks GitHub whether it is still current', async () => {
    const store = memoryStore();
    const a = tab('a', busHub(), store);
    a.cache.confirm('user:ada');
    const diff = source('diff --git a b');
    assert.equal(
      (await a.cache.fetchText({ key: KEY_TEXT, fetch: diff.fetch })).text,
      'diff --git a b'
    );
    const again = await a.cache.fetchText({ key: KEY_TEXT, fetch: diff.fetch });
    assert.equal(again.text, 'diff --git a b');
    assert.deepEqual(diff.asks, [undefined, 'W/"1"']);
  });

  it('keeps the notice a fallback source gave with the text', async () => {
    const store = memoryStore();
    const a = tab('a', busHub(), store);
    a.cache.confirm('user:ada');
    let asked = 0;
    const fetch = async (sent: string | undefined) => {
      asked += 1;
      return sent == null
        ? ({ status: 'fresh', text: 'p', etag: 'e', notice: 'cut' } as const)
        : ({ status: 'unchanged' } as const);
    };
    await a.cache.fetchText({ key: KEY_TEXT, fetch });
    assert.deepEqual(await a.cache.fetchText({ key: KEY_TEXT, fetch }), {
      text: 'p',
      notice: 'cut',
    });
    assert.equal(asked, 2);
  });

  it('never keeps an answer that states no ETag', async () => {
    const store = memoryStore();
    const a = tab('a', busHub(), store);
    a.cache.confirm('user:ada');
    await a.cache.fetchText({
      key: KEY_TEXT,
      fetch: () => Promise.resolve({ status: 'fresh', text: 'synthesized' }),
    });
    assert.equal(store.blobs.size, 0);
  });

  it('lets a tab that waited take the download without asking', async () => {
    const store = memoryStore();
    const hub = busHub();
    const a = tab('a', hub, store);
    const b = tab('b', hub, store);
    a.cache.confirm('user:ada');
    b.cache.confirm('user:ada');
    const held = gate();
    const asks: (string | undefined)[] = [];
    const fetch = async (sent: string | undefined) => {
      asks.push(sent);
      await held.closed;
      return { status: 'fresh', text: 'diff --git a b', etag: 'e' } as const;
    };
    const first = a.cache.fetchText({ key: KEY_TEXT, fetch });
    await until(() => asks.length === 1);
    const second = b.cache.fetchText({ key: KEY_TEXT, fetch });
    await until(() => b.entered() === 1);
    await settle(5);
    held.open();
    assert.equal((await first).text, 'diff --git a b');
    assert.equal((await second).text, 'diff --git a b');
    assert.equal(asks.length, 1);
  });

  it('keeps no download made before the confirmation', async () => {
    const store = memoryStore();
    const a = tab('a', busHub(), store);
    await a.cache.fetchText({ key: KEY_TEXT, fetch: source('p').fetch });
    a.cache.confirm('user:ada');
    await settle();
    assert.equal(store.blobs.size, 0);
  });

  it('waits for the confirmation, then sends the stored ETag', async () => {
    const store = memoryStore();
    const first = tab('a', busHub(), store);
    first.cache.confirm('user:ada');
    const diff = source('diff --git a b');
    await first.cache.fetchText({ key: KEY_TEXT, fetch: diff.fetch });

    // The next load: the download starts before the session has answered.
    const next = tab('b', busHub(), store);
    const asked = next.cache.fetchText({ key: KEY_TEXT, fetch: diff.fetch });
    await settle();
    next.cache.confirm('user:ada');
    assert.equal((await asked).text, 'diff --git a b');
    assert.deepEqual(diff.asks, [undefined, 'W/"1"']);
  });

  it('never sends or shows another account’s stored copy', async () => {
    const store = memoryStore();
    const first = tab('a', busHub(), store);
    first.cache.confirm('user:ada');
    await first.cache.fetchText({ key: KEY_TEXT, fetch: source('adas').fetch });

    const next = tab('b', busHub(), store);
    const graces = source('graces', 'W/"2"');
    const asked = next.cache.fetchText({ key: KEY_TEXT, fetch: graces.fetch });
    await settle();
    next.cache.confirm('user:grace');
    assert.equal((await asked).text, 'graces');
    assert.deepEqual(graces.asks, [undefined]);
  });

  it('keeps no download that crosses a change of account', async () => {
    const store = memoryStore();
    const a = tab('a', busHub(), store);
    a.cache.confirm('user:ada');
    const held = gate();
    const asked = a.cache.fetchText({
      key: KEY_TEXT,
      fetch: async () => {
        await held.closed;
        return { status: 'fresh', text: 'adas', etag: 'e' } as const;
      },
    });
    await settle();
    a.cache.confirm('user:grace');
    held.open();
    await asked;
    await settle();
    assert.equal(store.blobs.size, 0);
  });

  it('empties the blobs on sign-out and on a change of account', async () => {
    const store = memoryStore();
    const a = tab('a', busHub(), store);
    a.cache.confirm('user:ada');
    await a.cache.fetchText({ key: KEY_TEXT, fetch: source('p').fetch });
    assert.equal(store.blobs.size, 1);
    a.cache.confirm('user:grace');
    await settle();
    assert.equal(store.blobs.size, 0);

    await a.cache.fetchText({ key: KEY_TEXT, fetch: source('q').fetch });
    assert.equal(store.blobs.size, 1);
    await a.cache.endSession();
    assert.equal(store.blobs.size, 0);
  });
});
