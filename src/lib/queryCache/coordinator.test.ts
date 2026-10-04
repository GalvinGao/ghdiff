import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  localCoordinator,
  pickCoordinator,
  softLeaseCoordinator,
  webLocksCoordinator,
} from './coordinator.ts';
import { busHub, settle } from './testing.ts';

/** A task that records when it ran, and takes `ms` to finish. */
function tracer() {
  const events: string[] = [];
  const task = (name: string, ms: number) => async () => {
    events.push(`${name}:start`);
    await settle(ms);
    events.push(`${name}:end`);
    return name;
  };
  return { events, task };
}

describe('webLocksCoordinator', () => {
  it('runs two tabs one after the other on the same key', async () => {
    const a = webLocksCoordinator(navigator.locks);
    const b = webLocksCoordinator(navigator.locks);
    const { events, task } = tracer();
    const results = await Promise.all([
      a.exclusive('k', task('a', 20)),
      b.exclusive('k', task('b', 1)),
    ]);
    assert.deepEqual(results, ['a', 'b']);
    assert.deepEqual(events, ['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('lets different keys run together', async () => {
    const a = webLocksCoordinator(navigator.locks);
    const { events, task } = tracer();
    await Promise.all([
      a.exclusive('one', task('a', 10)),
      a.exclusive('two', task('b', 10)),
    ]);
    assert.deepEqual(events.slice(0, 2), ['a:start', 'b:start']);
  });

  it('abandons a wait when its signal aborts', async () => {
    const a = webLocksCoordinator(navigator.locks);
    const controller = new AbortController();
    const held = a.exclusive('k', () => settle(20));
    const waiting = a.exclusive('k', () => settle(1), controller.signal);
    controller.abort();
    await assert.rejects(waiting, { name: 'AbortError' });
    await held;
  });
});

describe('softLeaseCoordinator', () => {
  it('waits for the release another tab announces', async () => {
    const hub = busHub();
    const a = softLeaseCoordinator(hub.join(), { tab: 'a' });
    const b = softLeaseCoordinator(hub.join(), { tab: 'b' });
    const { events, task } = tracer();
    const first = a.exclusive('k', task('a', 20));
    // The lease reaches the other tab on a later task, as it would.
    await settle(2);
    const second = b.exclusive('k', task('b', 1));
    await Promise.all([first, second]);
    assert.deepEqual(events, ['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('fetches anyway once a silent tab has had its time', async () => {
    const hub = busHub();
    const silent = hub.join();
    const b = softLeaseCoordinator(hub.join(), { tab: 'b', waitMs: 30 });
    silent.post({ type: 'lease', key: 'k', tab: 'gone' });
    await settle(2);
    const started = Date.now();
    await b.exclusive('k', () => Promise.resolve('b'));
    assert.ok(Date.now() - started >= 25, 'it waited for the lease');
  });

  it('stops waiting the moment a closing tab lets go', async () => {
    const hub = busHub();
    const a = softLeaseCoordinator(hub.join(), { tab: 'a' });
    const b = softLeaseCoordinator(hub.join(), { tab: 'b' });
    void a.exclusive('k', () => new Promise(() => undefined));
    await settle(2);
    const started = Date.now();
    const second = b.exclusive('k', () => Promise.resolve('b'));
    a.releaseAll();
    assert.equal(await second, 'b');
    assert.ok(Date.now() - started < 1_000);
  });

  it('ignores a release from a tab that does not hold the lease', async () => {
    const hub = busHub();
    const other = hub.join();
    const b = softLeaseCoordinator(hub.join(), { tab: 'b', waitMs: 30 });
    other.post({ type: 'lease', key: 'k', tab: 'holder' });
    await settle(2);
    const started = Date.now();
    const running = b.exclusive('k', () => Promise.resolve('b'));
    other.post({ type: 'release', key: 'k', tab: 'stranger' });
    await running;
    assert.ok(Date.now() - started >= 25, 'the stranger released nothing');
  });

  it('abandons a wait when its signal aborts', async () => {
    const hub = busHub();
    const a = softLeaseCoordinator(hub.join(), { tab: 'a' });
    const b = softLeaseCoordinator(hub.join(), { tab: 'b' });
    const held = a.exclusive('k', () => settle(30));
    await settle(2);
    const controller = new AbortController();
    const waiting = b.exclusive('k', () => settle(1), controller.signal);
    controller.abort();
    await assert.rejects(waiting, { name: 'AbortError' });
    await held;
  });
});

describe('pickCoordinator', () => {
  const bus = busHub().join();

  it('takes Web Locks in a secure context', () => {
    const picked = pickCoordinator({
      secureContext: true,
      locks: navigator.locks,
      bus,
      tab: 't',
    });
    assert.equal(picked.kind, 'web-locks');
  });

  it('falls back to the lease where locks need a secure context', () => {
    const picked = pickCoordinator({
      secureContext: false,
      locks: navigator.locks,
      bus,
      tab: 't',
    });
    assert.equal(picked.kind, 'soft-lease');
    picked.dispose();
  });

  it('falls back to the lease in a browser without locks', () => {
    const picked = pickCoordinator({ secureContext: true, bus, tab: 't' });
    assert.equal(picked.kind, 'soft-lease');
    picked.dispose();
  });

  it('leaves each tab on its own with no channel either', () => {
    const picked = pickCoordinator({ secureContext: true, tab: 't' });
    assert.equal(picked.kind, 'local');
  });

  it('runs a local task straight away', async () => {
    assert.equal(
      await localCoordinator().exclusive('k', () => Promise.resolve(1)),
      1
    );
  });
});
