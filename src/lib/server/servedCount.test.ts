import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ServedBackend } from './servedBackend.ts';
import { createServedCounter } from './servedCount.ts';

/**
 * A backend in memory, plus the flush promise the counter hands to
 * `keepAlive` — which is what lets a test wait for the write to land.
 */
function fakeBackend(stored: string | null = null, failWrites = 0) {
  const writes: string[] = [];
  let failures = failWrites;
  let flush: Promise<void> = Promise.resolve();
  const backend: ServedBackend = {
    async read() {
      return stored;
    },
    async write(value) {
      if (failures > 0) {
        failures -= 1;
        throw new Error('store unavailable');
      }
      writes.push(value);
    },
    keepAlive(promise) {
      flush = promise.catch(() => {});
    },
  };
  return { writes, backend, flushed: () => flush };
}

test('every serve is counted, and a serve during a flush joins the next round', async () => {
  const { writes, backend, flushed } = fakeBackend('10');
  const counter = createServedCounter(backend, { writeIntervalMs: 0 });
  counter.recordServe();
  counter.recordServe();
  counter.recordServe();
  await flushed();
  // The first flush takes the first serve straight away; the two that landed
  // during it are folded into the next round, and nothing is lost.
  assert.deepEqual(writes, ['11', '13']);
});

test('a stale stored figure never takes the count backwards', async () => {
  const { writes, backend, flushed } = fakeBackend('5');
  const counter = createServedCounter(backend, { writeIntervalMs: 0 });
  counter.recordServe();
  await flushed();
  counter.recordServe();
  await flushed();
  // The store still says 5, but 6 was written, so the second serve adds to 6.
  assert.deepEqual(writes, ['6', '7']);
});

test('a failed write is handed back and retried by the next serve', async () => {
  const { writes, backend, flushed } = fakeBackend('10', 1);
  const counter = createServedCounter(backend, { writeIntervalMs: 0 });
  counter.recordServe();
  await flushed();
  assert.deepEqual(writes, []);
  counter.recordServe();
  await flushed();
  assert.deepEqual(writes, ['12']);
});

test('the footer figure parses what the store holds', async () => {
  const { backend } = fakeBackend('1234');
  const counter = createServedCounter(backend, { writeIntervalMs: 0 });
  assert.equal(await counter.readServedCount(), 1234);
});
