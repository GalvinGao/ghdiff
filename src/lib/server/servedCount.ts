import { env, waitUntil } from 'cloudflare:workers';

import { log, toLoggable } from '@/lib/logger';
import { parseServedCount } from '@/lib/servedCount';

// How many diffs this deployment has served, kept in Workers KV under one key.
//
// KV is not a counter, and this module is what stands between the two facts
// that say so. KV takes one write per second per key and answers a second one
// with 429, and two writes that overlap overwrite each other rather than add
// up. Neither is an edge case here: a reviewer opens three pull requests in
// three tabs at once, and that is a burst of three serves in one second.
//
// So a serve writes nothing. It adds one to a number this isolate holds, and
// one flush later folds however many arrived into a single read-add-write. The
// figure is still an estimate — an isolate that dies with a flush outstanding
// takes about a second's worth of serves with it, and two locations that write
// at the same moment still overwrite each other. A footer figure is allowed to
// be an estimate; a Durable Object is what an exact one would cost, and it is
// a second runtime object in a Worker with about 140 KiB of headroom left.

const KEY = 'served:total';

/** KV's own rule, and the reason a burst becomes one write instead of many. */
const WRITE_INTERVAL_MS = 1000;

/**
 * How many rounds one flush makes before it leaves the rest to the next serve.
 * Each round waits a second, and the flush runs inside `waitUntil`, so an
 * unbounded loop would hold one request open for as long as traffic lasts.
 */
const MAX_FLUSH_ROUNDS = 5;

/** Serves counted in this isolate that no write has carried yet. */
let pending = 0;
/** The flush in flight, so a serve during one joins it instead of racing it. */
let flushing: Promise<void> | undefined;
/** When the last write landed, so the next one keeps the interval above. */
let lastWriteAt = 0;
/**
 * The total this isolate last wrote. KV is read-after-write consistent in the
 * location that wrote, but only usually, and a read that came back stale would
 * take the figure backwards. The larger of the two is the one to add to.
 */
let lastWritten = 0;

/**
 * Counts one diff served. It never throws and never delays the response: the
 * flush runs in `waitUntil`, after the patch has gone to the browser.
 */
export function recordServe(): void {
  pending += 1;
  // A flush already scheduled will pick this one up on its next round.
  if (flushing != null) return;
  flushing = flush().finally(() => {
    flushing = undefined;
  });
  waitUntil(flushing);
}

/** The figure the footer prints. */
export async function readServedCount(): Promise<number> {
  return parseServedCount(await env.GHDIFF.get(KEY));
}

async function flush(): Promise<void> {
  for (let round = 0; round < MAX_FLUSH_ROUNDS && pending > 0; round += 1) {
    const wait = WRITE_INTERVAL_MS - (Date.now() - lastWriteAt);
    // Every serve that arrives during this wait joins the same write.
    if (wait > 0) await sleep(wait);

    const taking = pending;
    pending = 0;
    try {
      const stored = parseServedCount(await env.GHDIFF.get(KEY));
      const total = Math.max(stored, lastWritten) + taking;
      await env.GHDIFF.put(KEY, String(total));
      lastWritten = total;
      lastWriteAt = Date.now();
    } catch (error) {
      // Hand them back and stop. The next serve tries again, and a counter is
      // not a thing to fail a request over.
      pending += taking;
      log.error({ step: 'served-count', error: toLoggable(error) });
      return;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
