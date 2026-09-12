// Which runtime keeps the served counter is a build-time answer, folded by
// dead-code elimination in `servedBackend.ts` — nothing about it is asked at
// runtime.

import { servedBackend } from './servedBackend.ts';
import { createServedCounter } from './servedCount.ts';

const counter = createServedCounter(await servedBackend());

/** Counts one diff served. Fire-and-forget; the flush runs behind keepAlive. */
export const recordServe: () => void = counter.recordServe;

/** The figure the footer prints. */
export const readServedCount: () => Promise<number> = counter.readServedCount;
