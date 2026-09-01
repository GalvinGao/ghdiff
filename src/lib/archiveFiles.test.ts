import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ArchiveFileCollector } from './archiveFiles.ts';

const encoder = new TextEncoder();

function collector(
  paths: string[],
  options: { maxFileBytes?: number; maxKeptBytes?: number } = {}
): ArchiveFileCollector {
  return new ArchiveFileCollector({
    paths,
    maxFileBytes: options.maxFileBytes ?? 1024,
    maxKeptBytes: options.maxKeptBytes ?? 4096,
  });
}

function offer(sink: ArchiveFileCollector, path: string, text: string): void {
  const bytes = encoder.encode(text);
  if (sink.wants({ path, size: bytes.byteLength })) {
    sink.onFile(path, bytes);
  }
}

test('a wanted path is matched under the archive root and taken once', () => {
  const sink = collector(['src/a.ts']);
  offer(sink, 'ghdiff-abc123/src/a.ts', 'const a = 1;\n');
  assert.equal(sink.done, true);
  assert.deepEqual(sink.take('src/a.ts'), {
    kind: 'file',
    text: 'const a = 1;\n',
  });
  assert.deepEqual(sink.take('src/a.ts'), { kind: 'missing' });
});

test('the rest of the repository is refused', () => {
  const sink = collector(['src/a.ts']);
  assert.equal(sink.wants({ path: 'root/README.md', size: 10 }), false);
  assert.equal(sink.wants({ path: 'root-only-no-slash', size: 10 }), false);
  assert.equal(sink.done, false);
});

test('a file past the per-file ceiling is remembered as too large', () => {
  const sink = collector(['big.bin'], { maxFileBytes: 8 });
  assert.equal(sink.wants({ path: 'root/big.bin', size: 9 }), false);
  assert.equal(sink.done, true);
  assert.deepEqual(sink.take('big.bin'), { kind: 'too-large' });
});

test('a file past the kept total is dropped, not remembered', () => {
  const sink = collector(['a.txt', 'b.txt'], { maxKeptBytes: 10 });
  offer(sink, 'root/a.txt', 'eight ch');
  assert.equal(sink.wants({ path: 'root/b.txt', size: 8 }), false);
  assert.equal(sink.done, true);
  assert.deepEqual(sink.take('b.txt'), { kind: 'missing' });
  assert.equal((sink.take('a.txt') as { text: string }).text, 'eight ch');
});

test('done waits for every wanted path', () => {
  const sink = collector(['a.txt', 'b.txt']);
  offer(sink, 'root/a.txt', 'first');
  assert.equal(sink.done, false);
  offer(sink, 'root/b.txt', 'second');
  assert.equal(sink.done, true);
});

test('no wanted paths means done before the first byte', () => {
  assert.equal(collector([]).done, true);
});

test('bytes decode as UTF-8', () => {
  const sink = collector(['lä协.txt']);
  offer(sink, 'root/lä协.txt', 'naïve — 协议\n');
  assert.deepEqual(sink.take('lä协.txt'), {
    kind: 'file',
    text: 'naïve — 协议\n',
  });
});
