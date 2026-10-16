// Which runtime keeps the served counter is a build-time answer, folded by
// dead-code elimination in `backend.ts` — nothing about it is asked at
// runtime.
import { servedBackend } from './backend';
import { createServedCounter } from './count';

export const { recordServe, readServedCount } = createServedCounter(
  await servedBackend()
);
