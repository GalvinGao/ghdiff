import assert from 'node:assert/strict';
import { test } from 'vitest';

import { servedBackend } from './backend';

test('the memory backend reads back what it is written', async () => {
  const backend = await servedBackend();
  await backend.write('7');
  assert.equal(await backend.read(), '7');
});
