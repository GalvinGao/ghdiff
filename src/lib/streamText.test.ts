import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readStreamedText } from './streamText.ts';

// The response bodies here are real streams, because the whole point of this
// module is that it reads one a chunk at a time: a body handed over whole would
// test nothing it does.

/** A response whose body arrives in the given pieces. */
function streamed(chunks: readonly Uint8Array[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    })
  );
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

test('reads a body that arrives in one piece', async () => {
  const text = 'const answer = 42;\n';
  assert.equal(await readStreamedText(streamed([bytes(text)])), text);
});

test('joins every chunk of a body in order', async () => {
  const parts = ['one\n', 'two\n', 'three\n'];
  assert.equal(
    await readStreamedText(streamed(parts.map(bytes))),
    parts.join('')
  );
});

test('decodes a character split across two chunks', async () => {
  // Three bytes of one CJK character, cut after the first.
  const whole = bytes('漢字');
  assert.equal(
    await readStreamedText(streamed([whole.slice(0, 1), whole.slice(1)])),
    '漢字'
  );
});

test('reports the decoded bytes as they arrive', async () => {
  const seen: number[] = [];
  await readStreamedText(streamed([bytes('abcd'), bytes('ef'), bytes('ghi')]), {
    onBytes: (read) => seen.push(read),
  });
  // Running totals, one per chunk, ending on the whole body.
  assert.deepEqual(seen, [4, 6, 9]);
});

test('reports nothing for an empty body and still answers', async () => {
  const seen: number[] = [];
  const text = await readStreamedText(streamed([]), {
    onBytes: (read) => seen.push(read),
  });
  assert.equal(text, '');
  assert.deepEqual(seen, []);
});

test('stops a body that runs past the limit it was given', async () => {
  const chunk = bytes('x'.repeat(1024));
  await assert.rejects(
    readStreamedText(streamed([chunk, chunk, chunk]), {
      maxBytes: 2048,
      tooLarge: 'too big',
    }),
    (error: Error) => error.message === 'too big'
  );
});

test('takes a body of exactly the limit', async () => {
  const text = await readStreamedText(streamed([bytes('y'.repeat(2048))]), {
    maxBytes: 2048,
  });
  assert.equal(text.length, 2048);
});

test('reads a body of any size when it was given no limit', async () => {
  const chunk = bytes('z'.repeat(1024 * 1024));
  const chunks = Array.from({ length: 6 }, () => chunk);
  const text = await readStreamedText(streamed(chunks));
  assert.equal(text.length, 6 * 1024 * 1024);
});

test('falls back to text() for a response with no stream', async () => {
  const response = new Response(null);
  Object.defineProperty(response, 'body', { value: null });
  const seen: number[] = [];
  assert.equal(
    await readStreamedText(response, { onBytes: (read) => seen.push(read) }),
    ''
  );
  assert.deepEqual(seen, [0]);
});
